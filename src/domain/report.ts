import { isValidCivilDate } from "./dates";
import { formatMoney, monthlyTotals } from "./money";
import type { Category, FinancialProfile, Transaction } from "./models";

export type ReportFilters = {
  profileId: string;
  categoryId: string;
  from: string;
  to: string;
};
export type ReportRow = {
  date: string;
  profile: string;
  description: string;
  category: string;
  type: "Receita" | "Despesa";
  status: "Pendente" | "Pago" | "Recebido";
  value: string;
};
export type ReportModel = {
  filters: { profile: string; category: string; from: string; to: string };
  issuedAt: Date;
  totals: ReturnType<typeof monthlyTotals>;
  rows: ReportRow[];
};

const civil = (value: string) => value.split("-").reverse().join("/");
export const safeSlug = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "perfil";

export function buildReportModel(
  ownerUid: string,
  transactions: Transaction[],
  profiles: FinancialProfile[],
  categories: Category[],
  filters: ReportFilters,
  issuedAt = new Date(),
): ReportModel {
  if (!isValidCivilDate(filters.from) || !isValidCivilDate(filters.to))
    throw new Error("Informe datas válidas.");
  if (filters.from > filters.to)
    throw new Error("A data inicial deve ser anterior ou igual à data final.");
  const profile = filters.profileId
    ? profiles.find((item) => item.id === filters.profileId && item.ownerUid === ownerUid)
    : undefined;
  if (filters.profileId && !profile) throw new Error("Selecione um perfil válido.");
  const category = filters.categoryId
    ? categories.find((item) => item.id === filters.categoryId && item.ownerUid === ownerUid)
    : undefined;
  if (filters.categoryId && !category) throw new Error("Selecione uma categoria válida.");
  const selected = transactions
    .filter((item) => item.ownerUid === ownerUid && item.isDeleted !== true)
    .filter((item) => !filters.profileId || item.profileId === filters.profileId)
    .filter((item) => !filters.categoryId || item.categoryId === filters.categoryId)
    .filter((item) => item.dueDate >= filters.from && item.dueDate <= filters.to)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.description.localeCompare(b.description, "pt-BR"));
  if (!selected.length) throw new Error("Nenhum lançamento encontrado para o período e filtros informados.");
  const profileById = new Map(profiles.filter((item) => item.ownerUid === ownerUid).map((item) => [item.id, item.name]));
  return {
    filters: {
      profile: profile?.name ?? "Todos os perfis",
      category: category?.name ?? "Todas as categorias",
      from: civil(filters.from),
      to: civil(filters.to),
    },
    issuedAt,
    totals: monthlyTotals(selected),
    rows: selected.map((item) => ({
      date: civil(item.dueDate),
      profile: profileById.get(item.profileId) ?? "Perfil indisponível",
      description: item.description,
      category: item.categoryName,
      type: item.type === "income" ? "Receita" : "Despesa",
      status: item.status === "paid" ? "Pago" : item.status === "received" ? "Recebido" : "Pendente",
      value: `${item.type === "income" ? "+" : "-"} ${formatMoney(item.amountCents)}`,
    })),
  };
}

export function reportFileName(model: ReportModel) {
  const date = `${model.issuedAt.getFullYear()}-${String(model.issuedAt.getMonth() + 1).padStart(2, "0")}-${String(model.issuedAt.getDate()).padStart(2, "0")}`;
  const profile = model.filters.profile === "Todos os perfis" ? "" : `-${safeSlug(model.filters.profile)}`;
  return `gastos-simples-relatorio-${date}${profile}.pdf`;
}
