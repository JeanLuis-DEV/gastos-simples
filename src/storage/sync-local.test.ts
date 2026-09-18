import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "../domain/models";
import {
  clearUserDataForTesting,
  getSyncState,
  listOutbox,
  listSyncBaseSnapshots,
  listSyncConflicts,
  putSyncBaseSnapshot,
  putSyncConflict,
  putTransactionsAtomic,
  seriesRepository,
  seriesSegmentsRepository,
  transactionsRepository,
  updateSyncState,
  acknowledgePush,
  applyRemotePage,
  prepareFullResync,
  prepareRemoteSeed,
  categoriesRepository,
  profilesRepository,
} from "./database";

const item = (id: string, ownerUid = "sync-owner", changes: Partial<Transaction> = {}): Transaction => ({
  id,
  ownerUid,
  profileId: `profile:principal:${ownerUid}`,
  occurrenceKey: `single:${id}`,
  description: "Teste",
  amountCents: 100,
  type: "expense",
  status: "pending",
  dueDate: "2028-01-01",
  categoryId: "category",
  categoryName: "Casa",
  notes: "",
  kind: "single",
  createdAt: "2028-01-01T00:00:00.000Z",
  updatedAt: "2028-01-01T00:00:00.000Z",
  ...changes,
});

beforeEach(async () => {
  await clearUserDataForTesting("sync-owner");
  await clearUserDataForTesting("other-owner");
});

describe("fundação local da sincronização", () => {
  it("grava domínio e outbox na mesma mutação", async () => {
    await transactionsRepository.put(item("atomic"), "mutation-atomic");
    expect(await transactionsRepository.list("sync-owner")).toHaveLength(1);
    expect(await listOutbox("sync-owner")).toEqual([
      expect.objectContaining({ mutationId: "mutation-atomic", entityType: "transaction", recordId: "atomic", baseVersion: 0 }),
    ]);
  });

  it("repete a mesma chave idempotente sem nova versão e rejeita conteúdo diferente", async () => {
    const original = item("idempotent");
    await transactionsRepository.put(original, "same-mutation");
    const version = (await transactionsRepository.list("sync-owner"))[0]!.localVersion;
    await transactionsRepository.put(original, "same-mutation");
    expect((await transactionsRepository.list("sync-owner"))[0]!.localVersion).toBe(version);
    expect((await listOutbox("sync-owner")).filter((entry) => entry.mutationId === "same-mutation")).toHaveLength(1);
    await expect(transactionsRepository.put({ ...original, amountCents: 200 }, "same-mutation")).rejects.toThrow(/idempotente/);
    expect((await transactionsRepository.list("sync-owner"))[0]!.amountCents).toBe(100);
  });

  it("reverte o registro se a outbox falhar", async () => {
    const originalPut = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === "syncOutbox") throw new Error("falha simulada na outbox");
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    });
    await expect(transactionsRepository.put(item("rollback"))).rejects.toThrow();
    spy.mockRestore();
    expect(await transactionsRepository.list("sync-owner")).toEqual([]);
  });

  it("impede colisão de identificador entre contas", async () => {
    await transactionsRepository.put(item("shared-id", "sync-owner"));
    await expect(transactionsRepository.put(item("shared-id", "other-owner"))).rejects.toThrow(/outra conta/);
    expect(await transactionsRepository.list("other-owner")).toEqual([]);
  });

  it("impede duplicação ativa pela occurrenceKey mesmo com IDs diferentes", async () => {
    await transactionsRepository.put(item("first-occurrence"));
    await expect(transactionsRepository.put(item("second-occurrence", "sync-owner", {
      occurrenceKey: "single:first-occurrence",
    }))).rejects.toThrow(/ocorrência/);
    expect(await transactionsRepository.list("sync-owner")).toHaveLength(1);
  });

  it("mantém estado e deviceId estáveis e isolados por conta", async () => {
    const first = await getSyncState("sync-owner");
    expect(await getSyncState("sync-owner")).toEqual(first);
    expect((await getSyncState("other-owner")).deviceId).not.toBe(first.deviceId);
    expect(first).toMatchObject({ cursor: 0, epoch: 0, enabled: false });
    await updateSyncState("sync-owner", { cursor: 9, epoch: 3, lastSyncedAt: "2028-01-01T00:00:00.000Z" });
    const monotonic = await updateSyncState("sync-owner", { cursor: 2, epoch: 1 });
    expect(monotonic).toMatchObject({ cursor: 9, epoch: 3, deviceId: first.deviceId });
  });

  it("persiste snapshots-base e conflitos somente na conta correspondente", async () => {
    const base = item("merge-record", "sync-owner");
    await putSyncBaseSnapshot({
      id: "sync-owner:transaction:merge-record",
      ownerUid: "sync-owner",
      entityType: "transaction",
      recordId: "merge-record",
      serverVersion: 4,
      payload: base,
    });
    await putSyncConflict({
      id: "sync-owner:mutation-conflict:transaction:merge-record",
      ownerUid: "sync-owner",
      entityType: "transaction",
      recordId: "merge-record",
      mutationId: "mutation-conflict",
      base,
      local: { ...base, description: "Local" },
      remote: { ...base, description: "Remoto" },
      conflictingFields: ["description"],
      createdAt: "2028-01-01T00:00:00.000Z",
    });
    expect(await listSyncBaseSnapshots("sync-owner")).toHaveLength(1);
    expect(await listSyncConflicts("sync-owner")).toHaveLength(1);
    expect(await listSyncBaseSnapshots("other-owner")).toEqual([]);
    await expect(putSyncBaseSnapshot({
      id: "other-owner:transaction:merge-record",
      ownerUid: "other-owner",
      entityType: "transaction",
      recordId: "merge-record",
      serverVersion: 4,
      payload: base,
    })).rejects.toThrow(/inválido/);
  });

  it("materializa série e segmento explícitos junto das ocorrências", async () => {
    const seriesId = "series-1";
    await putTransactionsAtomic([
      item("installment-1", "sync-owner", { kind: "installment", seriesId, occurrenceKey: `${seriesId}:1`, installmentCurrent: 1, installmentTotal: 2 }),
      item("installment-2", "sync-owner", { kind: "installment", seriesId, occurrenceKey: `${seriesId}:2`, installmentCurrent: 2, installmentTotal: 2, dueDate: "2028-02-01" }),
    ], { mutationId: "series-mutation" });
    expect(await seriesRepository.list("sync-owner")).toEqual([expect.objectContaining({ id: seriesId, kind: "installment", installmentTotal: 2 })]);
    expect(await seriesSegmentsRepository.list("sync-owner")).toEqual([expect.objectContaining({ seriesId, effectiveFrom: "2028-01-01" })]);
    expect((await listOutbox("sync-owner")).filter((entry) => entry.mutationId === "series-mutation")).toHaveLength(4);
  });

  it("não altera série ou segmento ao materializar nova ocorrência e repete o lote de forma idempotente", async () => {
    const seriesId = "recurring-series";
    const january = item("recurring-jan", "sync-owner", { kind: "recurring", seriesId, occurrenceKey: `${seriesId}:2028-01` });
    await putTransactionsAtomic([january], { mutationId: "create-series" });
    const originalSeries = (await seriesRepository.list("sync-owner"))[0]!;
    const originalSegment = (await seriesSegmentsRepository.list("sync-owner"))[0]!;
    const february = item("recurring-feb", "sync-owner", { kind: "recurring", seriesId, occurrenceKey: `${seriesId}:2028-02`, dueDate: "2028-02-01" });
    await putTransactionsAtomic([february], { mutationId: "materialize-february" });
    await putTransactionsAtomic([february], { mutationId: "materialize-february" });

    expect(await seriesRepository.list("sync-owner")).toEqual([originalSeries]);
    expect(await seriesSegmentsRepository.list("sync-owner")).toEqual([originalSegment]);
    expect((await transactionsRepository.list("sync-owner")).find(({ id }) => id === february.id)?.localVersion).toBe(1);
    expect((await listOutbox("sync-owner")).filter((entry) => entry.mutationId === "materialize-february")).toHaveLength(1);
  });

  it("mescla campos diferentes recebidos pelo pull e refaz a mutação sobre a versão remota", async () => {
    await getSyncState("sync-owner");
    await transactionsRepository.put(item("merge-pull"), "initial");
    const initial = (await listOutbox("sync-owner"))[0]!;
    await acknowledgePush("sync-owner", [initial], { results: [{ mutationId: "initial", status: "applied", records: [{ entityType: "transaction", recordId: "merge-pull", version: 1, revision: 1, isDeleted: false }] }] });
    await transactionsRepository.put({ ...(await transactionsRepository.list("sync-owner"))[0]!, description: "Alteração local" }, "local-change");
    await applyRemotePage("sync-owner", [{ entityType: "transaction", recordId: "merge-pull", version: 2, revision: 2, isDeleted: false, payload: { profileId: "profile:principal:sync-owner", occurrenceKey: "single:merge-pull", description: "Teste", amountCents: 250, type: "expense", status: "pending", dueDate: "2028-01-01", categoryId: "category", categoryName: "Casa", notes: "", kind: "single" } }], { cursor: 2, epoch: 1, serverTime: "2028-01-02T00:00:00.000Z" });
    expect(await transactionsRepository.list("sync-owner")).toEqual([expect.objectContaining({ description: "Alteração local", amountCents: 250, serverVersion: 2 })]);
    expect(await listSyncConflicts("sync-owner")).toEqual([]);
    expect(await listOutbox("sync-owner")).toEqual([expect.objectContaining({ baseVersion: 2, baseSnapshot: expect.objectContaining({ amountCents: 250 }) })]);
  });

  it("preserva as duas propostas quando o mesmo campo mudou e não ressuscita tombstone", async () => {
    await getSyncState("sync-owner");
    await transactionsRepository.put(item("conflict-pull"), "initial-conflict");
    const initial = (await listOutbox("sync-owner"))[0]!;
    await acknowledgePush("sync-owner", [initial], { results: [{ mutationId: "initial-conflict", status: "applied", records: [{ entityType: "transaction", recordId: "conflict-pull", version: 1, revision: 1, isDeleted: false }] }] });
    await transactionsRepository.put({ ...(await transactionsRepository.list("sync-owner"))[0]!, description: "Local" }, "local-conflict");
    await applyRemotePage("sync-owner", [{ entityType: "transaction", recordId: "conflict-pull", version: 2, revision: 2, isDeleted: false, payload: { profileId: "profile:principal:sync-owner", occurrenceKey: "single:conflict-pull", description: "Remoto", amountCents: 100, type: "expense", status: "pending", dueDate: "2028-01-01", categoryId: "category", categoryName: "Casa", notes: "", kind: "single" } }], { cursor: 2, epoch: 1, serverTime: "2028-01-02T00:00:00.000Z" });
    expect(await listSyncConflicts("sync-owner")).toEqual([expect.objectContaining({ conflictingFields: ["description"], local: expect.objectContaining({ description: "Local" }), remote: expect.objectContaining({ description: "Remoto" }) })]);
    await applyRemotePage("sync-owner", [{ entityType: "transaction", recordId: "conflict-pull", version: 3, revision: 3, isDeleted: true, deletedAt: "2028-01-03T00:00:00.000Z", payload: { profileId: "profile:principal:sync-owner", occurrenceKey: "single:conflict-pull", description: "Remoto", amountCents: 100, type: "expense", status: "pending", dueDate: "2028-01-01", categoryId: "category", categoryName: "Casa", notes: "", kind: "single" } }], { cursor: 3, epoch: 1, serverTime: "2028-01-03T00:00:00.000Z" });
    expect(await transactionsRepository.list("sync-owner")).toEqual([expect.objectContaining({ description: "Local" })]);
    expect(await listSyncConflicts("sync-owner")).toEqual([expect.objectContaining({ remoteDeleted: true })]);
  });

  it("prepara full resync removendo apenas cópias limpas e preservando alterações locais", async () => {
    await getSyncState("sync-owner");
    await transactionsRepository.put(item("clean-remote"), "initial-clean");
    await transactionsRepository.put(item("pending-local"), "initial-pending");
    const initial = await listOutbox("sync-owner");
    await acknowledgePush("sync-owner", initial, { results: initial.map((entry, index) => ({ mutationId: entry.mutationId, status: "applied", records: [{ entityType: "transaction" as const, recordId: entry.recordId, version: 1, revision: index + 1, isDeleted: false }] })) });
    await transactionsRepository.put({ ...(await transactionsRepository.list("sync-owner")).find(({ id }) => id === "pending-local")!, description: "Ainda não enviada" }, "pending-change");
    await updateSyncState("sync-owner", { cursor: 20, epoch: 2 });
    await prepareFullResync("sync-owner");
    expect(await transactionsRepository.list("sync-owner")).toEqual([expect.objectContaining({ id: "pending-local", description: "Ainda não enviada", serverVersion: 0 })]);
    expect(await listOutbox("sync-owner")).toEqual([expect.objectContaining({ recordId: "pending-local", baseVersion: 0, baseSnapshot: undefined })]);
    expect(await getSyncState("sync-owner")).toMatchObject({ cursor: 0, epoch: 2 });
  });

  it("reconstrói o grafo local em ordem topológica quando o remoto do novo epoch está vazio", async () => {
    const timestamp = "2028-01-01T00:00:00.000Z";
    await getSyncState("sync-owner");
    await profilesRepository.put({ id: "profile:principal:sync-owner", ownerUid: "sync-owner", name: "Principal", createdAt: timestamp, updatedAt: timestamp }, "profile-initial");
    await categoriesRepository.put({ id: "category", ownerUid: "sync-owner", name: "Casa", type: "expense", isDefault: false }, "category-initial");
    await transactionsRepository.put(item("leaf-record"), "transaction-initial");
    const initial = await listOutbox("sync-owner");
    await acknowledgePush("sync-owner", initial, { results: initial.map((entry, index) => ({ mutationId: entry.mutationId, status: "applied", records: [{ entityType: entry.entityType, recordId: entry.recordId, version: 1, revision: index + 1, isDeleted: false }] })) });
    const current = (await transactionsRepository.list("sync-owner"))[0]!;
    await transactionsRepository.put({ ...current, description: "Alteração preservada" }, "leaf-only");

    await prepareRemoteSeed("sync-owner", 3);

    const seeded = (await listOutbox("sync-owner")).sort((left, right) => left.id.localeCompare(right.id));
    expect(seeded.map((entry) => entry.entityType)).toEqual(["profile", "category", "transaction"]);
    expect(seeded.every((entry) => entry.operation === "upsert" && entry.baseVersion === 0 && entry.baseSnapshot === undefined)).toBe(true);
    expect(await transactionsRepository.list("sync-owner")).toEqual([expect.objectContaining({ id: "leaf-record", description: "Alteração preservada", serverVersion: 0 })]);
    expect(await getSyncState("sync-owner")).toMatchObject({ cursor: 0, epoch: 3, seededEpoch: 3, lastError: undefined });
  });

  it("reescreve dependências locais e pendentes ao canonicalizar uma categoria", async () => {
    await categoriesRepository.put({ id: "category-canonical", ownerUid: "sync-owner", name: "Casa", type: "expense", isDefault: false }, "category-canonical-mutation");
    await categoriesRepository.put({ id: "category-alias", ownerUid: "sync-owner", name: "Casa", type: "expense", isDefault: false }, "category-alias-mutation");
    await transactionsRepository.put(item("alias-dependent", "sync-owner", { categoryId: "category-alias" }), "dependent-mutation");
    const pending = await listOutbox("sync-owner");
    const aliasEntry = pending.find((entry) => entry.recordId === "category-alias")!;

    await acknowledgePush("sync-owner", [aliasEntry], { results: [{ mutationId: aliasEntry.mutationId, status: "aliased", canonicalRecordId: "category-canonical" }] });

    expect(await categoriesRepository.list("sync-owner")).toEqual([expect.objectContaining({ id: "category-canonical" })]);
    expect(await transactionsRepository.list("sync-owner")).toEqual([expect.objectContaining({ id: "alias-dependent", categoryId: "category-canonical" })]);
    expect(await listOutbox("sync-owner")).toContainEqual(expect.objectContaining({
      recordId: "alias-dependent",
      payload: expect.objectContaining({ categoryId: "category-canonical" }),
    }));
  });
});
