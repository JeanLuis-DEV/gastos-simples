export type TransactionType = "expense" | "income";
export type TransactionStatus = "pending" | "paid" | "received";
export type TransactionKind = "single" | "recurring" | "installment";

export type SyncMetadata = {
  localVersion?: number;
  serverVersion?: number;
  serverRevision?: number;
  deletedAt?: string;
};

export type Transaction = SyncMetadata & {
  id: string;
  ownerUid: string;
  profileId: string;
  seriesId?: string;
  seriesEndDate?: string;
  occurrenceKey: string;
  description: string;
  amountCents: number;
  type: TransactionType;
  status: TransactionStatus;
  dueDate: string;
  categoryId: string;
  categoryName: string;
  notes: string;
  kind: TransactionKind;
  installmentCurrent?: number;
  installmentTotal?: number;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
};

export type FinancialProfile = SyncMetadata & {
  id: string;
  ownerUid: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
};

export type Category = SyncMetadata & {
  id: string;
  ownerUid: string;
  name: string;
  type: TransactionType;
  isDefault: boolean;
  canonicalKey?: string;
  isDeleted?: boolean;
};
export type CalculatorEntry = SyncMetadata & {
  id: string;
  ownerUid: string;
  expression: string;
  result: string;
  createdAt: string;
  isDeleted?: boolean;
};

export type TransactionSeries = SyncMetadata & {
  id: string;
  ownerUid: string;
  kind: Exclude<TransactionKind, "single">;
  startDate: string;
  endBefore?: string;
  installmentTotal?: number;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
};

export type TransactionSeriesSegment = SyncMetadata & {
  id: string;
  ownerUid: string;
  seriesId: string;
  effectiveFrom: string;
  anchorDueDate: string;
  profileId: string;
  description: string;
  amountCents: number;
  type: TransactionType;
  categoryId: string;
  categoryName: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
};
export type ThemePreference = "dark";

export type TransactionFilters = {
  profileId?: string;
  type?: TransactionType;
  categoryId?: string;
  kind?: TransactionKind;
  status?: TransactionStatus;
  from?: string;
  to?: string;
};

export const DEFAULT_CATEGORIES: Array<Pick<Category, "name" | "type">> = [
  { name: "Alimentação", type: "expense" },
  { name: "Transporte", type: "expense" },
  { name: "Moradia", type: "expense" },
  { name: "Saúde", type: "expense" },
  { name: "Educação", type: "expense" },
  { name: "Lazer", type: "expense" },
  { name: "Vestuário", type: "expense" },
  { name: "Serviços", type: "expense" },
  { name: "Contas e Taxas", type: "expense" },
  { name: "Salário", type: "income" },
  { name: "Freelance", type: "income" },
  { name: "Investimentos", type: "income" },
  { name: "Vendas", type: "income" },
  { name: "Aluguéis", type: "income" },
  { name: "Rendimentos", type: "income" },
  { name: "Bônus", type: "income" },
  { name: "Reembolso", type: "income" },
  { name: "Doações", type: "income" },
];
