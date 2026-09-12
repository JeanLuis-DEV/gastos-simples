import { addMonthsClamped, monthKey } from "./dates";
import type { Transaction, TransactionFilters } from "./models";

export type TransactionDraft = Omit<
  Transaction,
  "id" | "occurrenceKey" | "createdAt" | "updatedAt"
> & { installments?: number };

export function createTransactions(
  draft: TransactionDraft,
  now = new Date(),
): Transaction[] {
  if (!draft.description.trim()) throw new Error("Informe a descrição.");
  if (!Number.isSafeInteger(draft.amountCents) || draft.amountCents <= 0)
    throw new Error("Informe um valor maior que zero.");
  const count = draft.kind === "installment" ? (draft.installments ?? 0) : 1;
  if (
    draft.kind === "installment" &&
    (!Number.isInteger(count) || count < 2 || count > 999)
  )
    throw new Error("Parcelamento deve ter de 2 a 999 parcelas.");
  const seriesId = draft.kind === "single" ? undefined : crypto.randomUUID();
  const timestamp = now.toISOString();
  return Array.from({ length: count }, (_, index) => ({
    ...draft,
    installments: undefined,
    id: crypto.randomUUID(),
    seriesId,
    occurrenceKey:
      draft.kind === "recurring"
        ? `${seriesId}:${draft.dueDate.slice(0, 7)}`
        : `${seriesId ?? "single"}:${index + 1}`,
    dueDate: addMonthsClamped(draft.dueDate, index),
    installmentCurrent: draft.kind === "installment" ? index + 1 : undefined,
    installmentTotal: draft.kind === "installment" ? count : undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

export function recurringOccurrenceForMonth(
  items: Transaction[],
  month: string,
  now = new Date(),
): Transaction | undefined {
  const template = items
    .filter((item) => item.kind === "recurring" && item.seriesId)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const seriesEndDate = template
    ? items
        .filter((item) => item.seriesId === template.seriesId && item.seriesEndDate)
        .map((item) => item.seriesEndDate!)
        .sort()[0]
    : undefined;
  if (
    !template ||
    month < template.dueDate.slice(0, 7) ||
    (seriesEndDate && month >= seriesEndDate.slice(0, 7)) ||
    items.some(
      (item) =>
        item.seriesId === template.seriesId &&
        item.occurrenceKey === `${template.seriesId}:${month}`,
    )
  )
    return undefined;
  const [startYear, startMonth] = template.dueDate
    .slice(0, 7)
    .split("-")
    .map(Number);
  const [targetYear, targetMonth] = month.split("-").map(Number);
  const delta = (targetYear! - startYear!) * 12 + targetMonth! - startMonth!;
  const timestamp = now.toISOString();
  return {
    ...template,
    id: crypto.randomUUID(),
    occurrenceKey: `${template.seriesId}:${month}`,
    dueDate: addMonthsClamped(template.dueDate, delta),
    status: "pending",
    paidAt: undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
    isDeleted: false,
  };
}

export function filterTransactions(
  items: Transaction[],
  filters: TransactionFilters,
) {
  return items.filter(
    (item) =>
      (!filters.profileId || item.profileId === filters.profileId) &&
      (!filters.type || item.type === filters.type) &&
      (!filters.categoryId || item.categoryId === filters.categoryId) &&
      (!filters.kind || item.kind === filters.kind) &&
      (!filters.status || item.status === filters.status) &&
      (!filters.from || item.dueDate >= filters.from) &&
      (!filters.to || item.dueDate <= filters.to),
  );
}

export function transactionsForView(
  items: Transaction[],
  month: string,
  filters: TransactionFilters,
) {
  const base =
    filters.from || filters.to
      ? items
      : items.filter((item) => monthKey(item.dueDate) === month);
  return filterTransactions(base, filters);
}

export function markSettled(item: Transaction, at = new Date()): Transaction {
  return {
    ...item,
    status: item.type === "expense" ? "paid" : "received",
    paidAt: at.toISOString(),
    updatedAt: at.toISOString(),
  };
}

export type SeriesScope = "single" | "future";

export function selectSeriesItems(
  items: Transaction[],
  target: Transaction,
  scope: SeriesScope,
): Transaction[] {
  if (scope === "single" || !target.seriesId)
    return items.filter((item) => item.id === target.id);
  return items.filter(
    (item) =>
      item.seriesId === target.seriesId && item.dueDate >= target.dueDate,
  );
}

export function updateSeriesItems(
  items: Transaction[],
  target: Transaction,
  scope: SeriesScope,
  changes: Partial<
    Pick<
      Transaction,
      | "description"
      | "profileId"
      | "amountCents"
      | "type"
      | "dueDate"
      | "categoryId"
      | "categoryName"
      | "notes"
    >
  >,
  at = new Date(),
): Transaction[] {
  const selected = new Set(
    selectSeriesItems(items, target, scope).map(({ id }) => id),
  );
  const [targetYear, targetMonth] = target.dueDate
    .slice(0, 7)
    .split("-")
    .map(Number);
  return items.map((item) => {
    if (!selected.has(item.id)) return item;
    let dueDate = changes.dueDate;
    if (scope === "future" && changes.dueDate && item.id !== target.id) {
      const [itemYear, itemMonth] = item.dueDate
        .slice(0, 7)
        .split("-")
        .map(Number);
      const delta = (itemYear! - targetYear!) * 12 + itemMonth! - targetMonth!;
      dueDate = addMonthsClamped(changes.dueDate, delta);
    }
    const nextType = changes.type ?? item.type;
    const nextStatus =
      item.status === "pending"
        ? "pending"
        : nextType === "expense"
          ? "paid"
          : "received";
    return {
      ...item,
      ...changes,
      status: nextStatus,
      dueDate: dueDate ?? item.dueDate,
      updatedAt: at.toISOString(),
    };
  });
}

export type TransactionRestructureDraft = Pick<
  Transaction,
  | "ownerUid"
  | "profileId"
  | "type"
  | "description"
  | "amountCents"
  | "dueDate"
  | "categoryId"
  | "categoryName"
  | "notes"
  | "kind"
> & { installments?: number };

export function restructureTransactionSeries(
  items: Transaction[],
  target: Transaction,
  draft: TransactionRestructureDraft,
  at = new Date(),
): Transaction[] {
  if (draft.kind === target.kind)
    throw new Error("A forma do lançamento não foi alterada.");
  const timestamp = at.toISOString();
  const oldSeries = target.seriesId
    ? items.filter((item) => item.seriesId === target.seriesId)
    : items.filter((item) => item.id === target.id);
  if (!oldSeries.some((item) => item.id === target.id))
    throw new Error("Lançamento inexistente.");
  const futureIds = new Set(
    oldSeries
      .filter((item) => item.dueDate >= target.dueDate)
      .map((item) => item.id),
  );
  const stopped = oldSeries.map((item) => ({
    ...item,
    ...(target.kind === "recurring"
      ? { seriesEndDate: target.dueDate }
      : {}),
    ...(futureIds.has(item.id) ? { isDeleted: true } : {}),
    updatedAt: timestamp,
  }));
  const status =
    target.status === "pending"
      ? "pending"
      : draft.type === "expense"
        ? "paid"
        : "received";
  const replacements = createTransactions(
    {
      ...draft,
      status,
      paidAt: status === "pending" ? undefined : target.paidAt,
    },
    at,
  ).map((item, index) =>
    index === 0
      ? item
      : { ...item, status: "pending" as const, paidAt: undefined },
  );
  return [...stopped, ...replacements];
}
