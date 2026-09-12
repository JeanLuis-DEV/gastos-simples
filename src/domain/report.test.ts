import { describe, expect, it } from "vitest";
import type { Category, FinancialProfile, Transaction } from "./models";
import { buildReportModel, reportFileName, safeSlug } from "./report";

const ownerUid = "report-user";
const profiles: FinancialProfile[] = [
  { id: "principal", ownerUid, name: "Principal", createdAt: "2028-01-01T00:00:00Z", updatedAt: "2028-01-01T00:00:00Z" },
  { id: "joao", ownerUid, name: "João & Família", createdAt: "2028-01-01T00:00:00Z", updatedAt: "2028-01-01T00:00:00Z" },
];
const categories: Category[] = [
  { id: "salary", ownerUid, name: "Salário", type: "income", isDefault: true },
  { id: "home", ownerUid, name: "Moradia", type: "expense", isDefault: true },
];
const transaction = (overrides: Partial<Transaction>): Transaction => ({
  id: "1", ownerUid, profileId: "principal", occurrenceKey: "single:1", description: "Água", amountCents: 10000,
  type: "expense", status: "pending", dueDate: "2028-01-10", categoryId: "home", categoryName: "Moradia", notes: "",
  kind: "single", createdAt: "2028-01-01T00:00:00Z", updatedAt: "2028-01-01T00:00:00Z", ...overrides,
});

describe("relatório financeiro local", () => {
  it("filtra inclusivamente, exclui apagados e dados de outro usuário", () => {
    const model = buildReportModel(ownerUid, [
      transaction({ id: "b", description: "Zebra", dueDate: "2028-01-31" }),
      transaction({ id: "a", description: "Água", dueDate: "2028-01-01" }),
      transaction({ id: "deleted", isDeleted: true }),
      transaction({ id: "foreign", ownerUid: "other" }),
    ], profiles, categories, { profileId: "", categoryId: "home", from: "2028-01-01", to: "2028-01-31" });
    expect(model.rows.map((row) => row.description)).toEqual(["Água", "Zebra"]);
    expect(model.totals.expensePlanned).toBe(20000);
  });
  it("formata acentos, sinais, situação e nome seguro", () => {
    const issuedAt = new Date(2028, 0, 5, 12, 30);
    const model = buildReportModel(ownerUid, [transaction({ profileId: "joao", type: "income", status: "received", categoryId: "salary", categoryName: "Salário", amountCents: 123456 })], profiles, categories, { profileId: "joao", categoryId: "salary", from: "2028-01-01", to: "2028-01-31" }, issuedAt);
    expect(model.rows[0]).toMatchObject({ profile: "João & Família", type: "Receita", status: "Recebido", value: "+ R$ 1.234,56" });
    expect(safeSlug(" João & Família ")).toBe("joao-familia");
    expect(reportFileName(model)).toBe("gastos-simples-relatorio-2028-01-05-joao-familia.pdf");
  });
  it("rejeita intervalo, referências e resultado vazio", () => {
    expect(() => buildReportModel(ownerUid, [], profiles, categories, { profileId: "", categoryId: "", from: "2028-02-01", to: "2028-01-01" })).toThrow(/data inicial/);
    expect(() => buildReportModel(ownerUid, [], profiles, categories, { profileId: "foreign", categoryId: "", from: "2028-01-01", to: "2028-01-31" })).toThrow(/perfil válido/);
    expect(() => buildReportModel(ownerUid, [], profiles, categories, { profileId: "", categoryId: "", from: "2028-01-01", to: "2028-01-31" })).toThrow(/Nenhum lançamento/);
  });
});
