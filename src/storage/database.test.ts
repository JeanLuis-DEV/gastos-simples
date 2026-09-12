import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  categoriesRepository,
  addFinancialProfile,
  clearUserData,
  deleteFinancialProfile,
  ensureDefaultCategories,
  ensureFinancialProfiles,
  exportBackup,
  importBackup,
  deleteCategory,
  transactionsRepository,
  profilesRepository,
  resetUserData,
  calculatorRepository,
  getSelectedProfile,
  setSelectedProfile,
  renameFinancialProfile,
  validateBackup,
} from "./database";
import { DEFAULT_CATEGORIES, type Transaction } from "../domain/models";

const item = (id: string, ownerUid: string): Transaction => ({
  id,
  ownerUid,
  profileId: `profile:principal:${ownerUid}`,
  occurrenceKey: `single:${id}`,
  description: "Teste",
  amountCents: 199,
  type: "expense",
  status: "pending",
  dueDate: "2028-01-01",
  categoryId: "c",
  categoryName: "Casa",
  notes: "",
  kind: "single",
  createdAt: "2028-01-01T00:00:00Z",
  updatedAt: "2028-01-01T00:00:00Z",
});
beforeEach(async () => {
  await clearUserData("u1");
  await clearUserData("u2");
  await categoriesRepository.put({
    id: "c",
    ownerUid: "u1",
    name: "Casa",
    type: "expense",
    isDefault: false,
  });
});
describe("IndexedDB por usuário", () => {
  it("isola dados pelo Firebase UID", async () => {
    await transactionsRepository.put(item("1", "u1"));
    await transactionsRepository.put(item("2", "u2"));
    expect(await transactionsRepository.list("u1")).toEqual([item("1", "u1")]);
    expect(await transactionsRepository.list("u2")).toEqual([item("2", "u2")]);
  });
  it("não permite exclusão por outro usuário", async () => {
    await transactionsRepository.put(item("1", "u1"));
    expect(await transactionsRepository.delete("1", "u2")).toBeUndefined();
    expect(await transactionsRepository.list("u1")).toHaveLength(1);
  });
  it("não sobrescreve categorias padrão ao alternar de usuário", async () => {
    await categoriesRepository.clear("u1");
    await ensureDefaultCategories("u1");
    await ensureDefaultCategories("u2");
    expect(await categoriesRepository.list("u1")).toHaveLength(18);
    expect(await categoriesRepository.list("u2")).toHaveLength(18);
    const ids = [
      ...(await categoriesRepository.list("u1")),
      ...(await categoriesRepository.list("u2")),
    ].map((value) => value.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("protege categorias padrão contra exclusão na persistência", async () => {
    await categoriesRepository.clear("u1");
    await ensureDefaultCategories("u1");
    const standard = (await categoriesRepository.list("u1"))[0]!;
    await expect(deleteCategory("u1", standard.id)).rejects.toThrow(
      /padrão não podem ser excluídas/,
    );
  });
  it("exclui categoria personalizada sem uso ativo", async () => {
    await deleteCategory("u1", "c");
    expect(await categoriesRepository.list("u1")).toEqual([]);
  });
  it("ignora lançamento logicamente excluído ao excluir categoria", async () => {
    await transactionsRepository.put({ ...item("deleted", "u1"), isDeleted: true });
    await deleteCategory("u1", "c");
    expect(await categoriesRepository.list("u1")).toEqual([]);
  });
  it("protege categoria ligada a lançamento ativo", async () => {
    await transactionsRepository.put(item("active", "u1"));
    await expect(deleteCategory("u1", "c")).rejects.toThrow(
      /Altere a categoria dos lançamentos ativos/,
    );
    expect(await categoriesRepository.list("u1")).toHaveLength(1);
  });
  it("preserva isolamento por ownerUid ao excluir categoria", async () => {
    await deleteCategory("u2", "c");
    expect(await categoriesRepository.list("u1")).toHaveLength(1);
  });
});
describe("backup atômico e versionado", () => {
  it("exporta e importa backup válido", async () => {
    await transactionsRepository.put(item("1", "u1"));
    const backup = await exportBackup("u1");
    expect(backup.schemaVersion).toBe(3);
    await clearUserData("u1");
    await importBackup("u1", validateBackup(backup, "u1"), "replace");
    expect(await transactionsRepository.list("u1")).toHaveLength(1);
  });
  it("rejeita backup inválido antes de gravar", async () => {
    await transactionsRepository.put(item("1", "u1"));
    const backup = await exportBackup("u1");
    expect(() => validateBackup({ ...backup, ownerUid: "u2" }, "u1")).toThrow(
      /outra conta/,
    );
    expect(await transactionsRepository.list("u1")).toHaveLength(1);
  });
  it("rejeita campos, duplicidades e datas inválidas sem alterar dados", async () => {
    await transactionsRepository.put(item("1", "u1"));
    const backup = await exportBackup("u1");
    expect(() =>
      validateBackup(
        {
          ...backup,
          transactions: [
            item("x", "u1"),
            { ...item("x", "u1"), dueDate: "2028-02-30" },
          ],
        },
        "u1",
      ),
    ).toThrow(/dados inválidos/);
    expect(await transactionsRepository.list("u1")).toEqual([item("1", "u1")]);
  });
  it("aceita tema legado e o normaliza para escuro", async () => {
    const backup = await exportBackup("u1");
    const normalized = validateBackup(
      { ...backup, preferences: { ...backup.preferences, theme: "light" } },
      "u1",
    );
    expect(normalized.preferences.theme).toBe("dark");
    await importBackup("u1", normalized, "replace");
    expect((await exportBackup("u1")).preferences.theme).toBe("dark");
  });
  it("aceita preferência legada falsa, mas mantém confirmação obrigatória", async () => {
    const backup = await exportBackup("u1");
    const normalized = validateBackup(
      {
        ...backup,
        preferences: { ...backup.preferences, confirmBeforeDelete: false },
      },
      "u1",
    );
    expect(normalized.preferences.confirmBeforeDelete).toBe(true);
    await importBackup("u1", normalized, "replace");
    expect((await exportBackup("u1")).preferences.confirmBeforeDelete).toBe(true);
  });
});

describe("perfis financeiros locais", () => {
  it("cria Principal uma única vez e isola por UID", async () => {
    await ensureFinancialProfiles("u1");
    await ensureFinancialProfiles("u1");
    await ensureFinancialProfiles("u2");
    expect((await profilesRepository.list("u1")).map((profile) => profile.name)).toEqual(["Principal"]);
    expect(await profilesRepository.list("u2")).toHaveLength(1);
  });
  it("valida duplicidade normalizada e renomeia", async () => {
    await ensureFinancialProfiles("u1");
    const joao = await addFinancialProfile("u1", " João ");
    await expect(addFinancialProfile("u1", "joão")).rejects.toThrow(/já existe/i);
    const renamed = await renameFinancialProfile("u1", joao.id, "Maria");
    expect(renamed.name).toBe("Maria");
  });
  it("transfere ativos e excluídos atomicamente antes de excluir", async () => {
    const [principal] = await ensureFinancialProfiles("u1");
    const secondary = await addFinancialProfile("u1", "Casa");
    await transactionsRepository.putMany([
      { ...item("active-profile", "u1"), profileId: secondary.id },
      { ...item("deleted-profile", "u1"), profileId: secondary.id, isDeleted: true },
    ]);
    await deleteFinancialProfile("u1", secondary.id, principal!.id);
    expect((await transactionsRepository.list("u1")).every((value) => value.profileId === principal!.id)).toBe(true);
    expect(await profilesRepository.list("u1")).toHaveLength(1);
  });
  it("impede excluir o único perfil", async () => {
    const [principal] = await ensureFinancialProfiles("u1");
    await expect(deleteFinancialProfile("u1", principal!.id)).rejects.toThrow(/único perfil/);
  });
  it("aceita backup v2 e associa lançamentos ao Principal", async () => {
    await ensureFinancialProfiles("u1");
    const current = await exportBackup("u1");
    const legacy = {
      ...current,
      schemaVersion: 2,
      profiles: undefined,
      transactions: current.transactions.map(({ profileId: _profileId, ...transaction }) => transaction),
      preferences: { theme: "light", confirmBeforeDelete: true },
    };
    const normalized = validateBackup(legacy, "u1");
    expect(normalized.schemaVersion).toBe(3);
    expect(normalized.profiles[0]?.name).toBe("Principal");
    expect(normalized.transactions.every((transaction) => transaction.profileId === normalized.profiles[0]?.id)).toBe(true);
  });
});

describe("reinício atômico dos dados locais", () => {
  it("remove todos os dados da conta e recria somente os padrões", async () => {
    const ownerUid = "reset-database-user";
    const [principal] = await ensureFinancialProfiles(ownerUid);
    await addFinancialProfile(ownerUid, "Casa");
    await categoriesRepository.put({ id: "custom", ownerUid, name: "Viagem", type: "expense", isDefault: false });
    await transactionsRepository.put({ ...item("reset-item", ownerUid), profileId: principal!.id, isDeleted: true });
    await calculatorRepository.put({ id: "calc", ownerUid, expression: "2 + 2", result: "4", createdAt: "2028-01-01T00:00:00Z" });
    await setSelectedProfile(ownerUid, principal!.id);

    await resetUserData(ownerUid);

    const profiles = await profilesRepository.list(ownerUid);
    expect(await transactionsRepository.list(ownerUid)).toEqual([]);
    expect(await calculatorRepository.list(ownerUid)).toEqual([]);
    expect((await categoriesRepository.list(ownerUid)).map((category) => category.name).sort()).toEqual(
      DEFAULT_CATEGORIES.map((category) => category.name).sort(),
    );
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.name).toBe("Principal");
    expect(await getSelectedProfile(ownerUid, profiles)).toBe("");
  });

  it("reverte toda a transação se a recriação falhar", async () => {
    const ownerUid = "reset-rollback-user";
    const [principal] = await ensureFinancialProfiles(ownerUid);
    await categoriesRepository.put({ id: "keep-category", ownerUid, name: "Manter", type: "expense", isDefault: false });
    await transactionsRepository.put({ ...item("keep-transaction", ownerUid), profileId: principal!.id });
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if ((value as { name?: string }).name === "Alimentação") throw new Error("falha simulada");
      return originalPut.call(this, value, key);
    });

    await expect(resetUserData(ownerUid)).rejects.toThrow(/cancelado sem alterar/);
    put.mockRestore();

    expect((await transactionsRepository.list(ownerUid)).map(({ id }) => id)).toEqual(["keep-transaction"]);
    expect((await categoriesRepository.list(ownerUid)).map(({ id }) => id)).toEqual(["keep-category"]);
    expect((await profilesRepository.list(ownerUid)).map(({ id }) => id)).toEqual([principal!.id]);
  });
});
