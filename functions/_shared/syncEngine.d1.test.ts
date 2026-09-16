// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";
import type { D1Database, Env } from "../types";
import { deleteFinancialData, exportRemoteData, pullSync, pushSync } from "./syncEngine";
import type { PushRequest } from "./syncValidation";
import { appendImportChunk, cleanupExpiredImports, commitImport, startImport } from "./syncImport";

const migration1 = readFileSync(resolve("migrations/0001_initial.sql"), "utf8");
const migration2 = readFileSync(resolve("migrations/0002_sync.sql"), "utf8");
const migration3 = readFileSync(resolve("migrations/0003_sync_imports.sql"), "utf8");
const migration4 = readFileSync(resolve("migrations/0004_sync_maintenance.sql"), "utf8");
const encryptionKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(19)));
const instances: Miniflare[] = [];

async function applyMigration(DB: D1Database, sql: string) {
  const statements = sql.split(";").map((statement) => statement.trim()).filter(Boolean);
  await DB.batch(statements.map((statement) => DB.prepare(statement)));
}

async function environment() {
  const instance = new Miniflare(convertV4MiniflareOptions({
    compatibilityDate: "2025-01-01",
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: crypto.randomUUID() },
  }));
  instances.push(instance);
  const DB = await instance.getD1Database("DB");
  await applyMigration(DB, migration1);
  await applyMigration(DB, migration2);
  await applyMigration(DB, migration3);
  await applyMigration(DB, migration4);
  await DB.batch([
    DB.prepare("INSERT INTO users (firebase_uid,email,created_at,updated_at) VALUES (?,?,?,?)").bind("uid-a", "a@example.test", "2028-01-01", "2028-01-01"),
    DB.prepare("INSERT INTO sync_accounts (firebase_uid,sync_epoch,revision,activated_at,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("uid-a", 1, 0, "2028-01-01", "2028-01-01", "2028-01-01"),
  ]);
  return {
    DB,
    APP_ORIGIN: "https://app.test",
    FIREBASE_PROJECT_ID: "project",
    SYNC_ENABLED: "true",
    SYNC_ACTIVE_KEY_ID: "test-v1",
    SYNC_ENCRYPTION_KEYS: JSON.stringify({ "test-v1": encryptionKey }),
  } as Env;
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

describe("sincronização com D1 local real", { timeout: 20_000 }, () => {
  it("grava dependências em ordem, cifra o conteúdo, faz pull e repete o lote com segurança", async () => {
    const env = await environment();
    const body: PushRequest = {
      protocolVersion: 1,
      syncEpoch: 1,
      batchId: "batch-real-1",
      deviceId: "device-real-1",
      operations: [
        { command: "upsert-record", mutationId: "mutation-transaction", entityType: "transaction", recordId: "transaction-1", baseVersion: 0, payload: { profileId: "profile-1", occurrenceKey: "single:transaction-1", description: "Conteúdo financeiro confidencial", amountCents: 12345, type: "expense", status: "pending", dueDate: "2028-02-01", categoryId: "category-1", categoryName: "Casa", notes: "observação confidencial", kind: "single" } },
        { command: "upsert-record", mutationId: "mutation-category", entityType: "category", recordId: "category-1", baseVersion: 0, payload: { name: "Casa", type: "expense", isDefault: false } },
        { command: "upsert-record", mutationId: "mutation-profile", entityType: "profile", recordId: "profile-1", baseVersion: 0, payload: { name: "Principal" } },
      ],
    };
    const first = await pushSync(env, { uid: "uid-a", email: "a@example.test" }, body);
    expect(first).toMatchObject({ batchId: body.batchId, committedRevision: 3, highWatermark: 3 });
    const stored = await env.DB.prepare("SELECT payload_ciphertext FROM sync_transactions WHERE firebase_uid=? AND record_id=?").bind("uid-a", "transaction-1").first<{ payload_ciphertext: string }>();
    expect(stored?.payload_ciphertext).not.toContain("Conteúdo financeiro confidencial");
    const pulled = await pullSync(env, "uid-a", { cursor: 0, untilRevision: 3, limit: 200, epoch: 1, deviceId: "device-real-1", protocolVersion: 1 });
    expect(pulled).toMatchObject({ cursor: 3, highWatermark: 3, hasMore: false });
    expect(pulled.records).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: "transaction", payload: expect.objectContaining({ amountCents: 12345 }) })]));
    await expect(pushSync(env, { uid: "uid-a", email: "a@example.test" }, body)).resolves.toEqual(first);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM sync_transactions WHERE firebase_uid=?").bind("uid-a").first<{ count: number }>()).toEqual({ count: 1 });
    const exportFirst = await exportRemoteData(env, "uid-a", { cursor: 0, limit: 2 });
    expect(exportFirst).toMatchObject({ highWatermark: 3, hasMore: true });
    const exportSecond = await exportRemoteData(env, "uid-a", { cursor: exportFirst.cursor, untilRevision: exportFirst.highWatermark, limit: 2 });
    expect([...exportFirst.records, ...exportSecond.records]).toHaveLength(3);
    expect(exportSecond).toMatchObject({ highWatermark: 3, cursor: 3, hasMore: false });
    await env.DB.prepare("UPDATE sync_accounts SET min_available_revision=3 WHERE firebase_uid=?").bind("uid-a").run();
    await expect(pullSync(env, "uid-a", { cursor: 1, limit: 200, epoch: 1, deviceId: "device-old", protocolVersion: 1 })).rejects.toThrow(/resync_required/);
    await expect(pullSync(env, "uid-a", { cursor: 0, limit: 200, epoch: 1, deviceId: "device-reset", protocolVersion: 1 })).resolves.toMatchObject({ cursor: 3, hasMore: false, minAvailableRevision: 3 });
  });

  it("mantém importação em staging e substitui o snapshot somente no commit atômico", async () => {
    const env = await environment();
    const started = await startImport(env, "uid-a", "replace", 0);
    await expect(startImport(env, "uid-a", "replace", 0)).resolves.toEqual(started);
    const records = [
      { entityType: "profile" as const, recordId: "profile-1", payload: { name: "Principal" } },
      { entityType: "category" as const, recordId: "category-1", payload: { name: "Casa", type: "expense", isDefault: false } },
      { entityType: "transaction" as const, recordId: "transaction-1", payload: { profileId: "profile-1", occurrenceKey: "single:transaction-1", description: "Importado", amountCents: 500, type: "expense", status: "pending", dueDate: "2028-01-01", categoryId: "category-1", categoryName: "Casa", notes: "", kind: "single" } },
    ];
    const firstChunk = await appendImportChunk(env, "uid-a", started.sessionId, 0, records);
    await expect(appendImportChunk(env, "uid-a", started.sessionId, 0, records)).resolves.toEqual(firstChunk);
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM sync_transactions WHERE firebase_uid=?").bind("uid-a").first<{ count: number }>()).toEqual({ count: 0 });
    await expect(commitImport(env, "uid-a", started.sessionId)).resolves.toMatchObject({ committed: true, syncEpoch: 2, importedRecords: 3 });
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM sync_transactions WHERE firebase_uid=?").bind("uid-a").first<{ count: number }>()).toEqual({ count: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM sync_import_records WHERE firebase_uid=? AND session_id=?").bind("uid-a", started.sessionId).first<{ count: number }>()).toEqual({ count: 0 });
    await expect(commitImport(env, "uid-a", started.sessionId)).resolves.toMatchObject({ committed: true, syncEpoch: 2 });
  });

  it("limpa sessões de importação expiradas sem job remoto", async () => {
    const env = await environment();
    const started = await startImport(env, "uid-a", "replace", 0);
    await env.DB.prepare("UPDATE sync_import_sessions SET expires_at=? WHERE firebase_uid=? AND session_id=?").bind("2027-01-01T00:00:00.000Z", "uid-a", started.sessionId).run();
    await expect(cleanupExpiredImports(env, new Date("2028-01-01T00:00:00.000Z"))).resolves.toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM sync_import_sessions WHERE firebase_uid=?").bind("uid-a").first<{ count: number }>()).toEqual({ count: 0 });
  });

  it("mantém somente os 100 cálculos mais recentes e publica tombstone para o excedente", async () => {
    const env = await environment();
    const operations = Array.from({ length: 100 }, (_, index) => ({
      command: "upsert-record" as const,
      mutationId: `mutation-calculator-${index}`,
      entityType: "calculator" as const,
      recordId: `calculator-${index}`,
      baseVersion: 0,
      payload: { expression: `${index}+1`, result: String(index + 1), createdAt: new Date(Date.UTC(2028, 0, 1, 0, index)).toISOString() },
    }));
    await pushSync(env, { uid: "uid-a", email: "a@example.test" }, { protocolVersion: 1, syncEpoch: 1, batchId: "batch-calculator-100", deviceId: "device-real-1", operations });
    await pushSync(env, { uid: "uid-a", email: "a@example.test" }, {
      protocolVersion: 1,
      syncEpoch: 1,
      batchId: "batch-calculator-101",
      deviceId: "device-real-1",
      operations: [{ command: "upsert-record", mutationId: "mutation-calculator-100", entityType: "calculator", recordId: "calculator-100", baseVersion: 0, payload: { expression: "100+1", result: "101", createdAt: "2028-01-02T00:00:00.000Z" } }],
    });
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM sync_calculator_entries WHERE firebase_uid=? AND is_deleted=0").bind("uid-a").first<{ count: number }>()).toEqual({ count: 100 });
    expect(await env.DB.prepare("SELECT is_deleted FROM sync_calculator_entries WHERE firebase_uid=? AND record_id=?").bind("uid-a", "calculator-0").first<{ is_deleted: number }>()).toEqual({ is_deleted: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM sync_tombstones WHERE firebase_uid=? AND entity_type='calculator'").bind("uid-a").first<{ count: number }>()).toEqual({ count: 1 });
  });

  it("remove também os blocos temporários ao excluir definitivamente os dados remotos", async () => {
    const env = await environment();
    await startImport(env, "uid-a", "replace", 0);
    await deleteFinancialData(env, "uid-a", "request-delete-staging", 1, new Date("2028-01-01T00:00:00.000Z"));
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM sync_import_sessions WHERE firebase_uid=?").bind("uid-a").first<{ count: number }>()).toEqual({ count: 0 });
  });
});
