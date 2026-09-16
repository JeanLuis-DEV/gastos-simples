import type { CalculatorEntry, Category, FinancialProfile, Transaction, TransactionSeries, TransactionSeriesSegment } from "../domain/models";
import type { SyncEntityType, SyncPayload } from "./types";

export function payloadForServer(entityType: SyncEntityType, item: SyncPayload): Record<string, unknown> {
  switch (entityType) {
    case "profile": {
      const value = item as FinancialProfile;
      return { name: value.name };
    }
    case "category": {
      const value = item as Category;
      return { name: value.name, type: value.type, isDefault: value.isDefault };
    }
    case "series": {
      const value = item as TransactionSeries;
      return { kind: value.kind, startDate: value.startDate, ...(value.endBefore ? { endBefore: value.endBefore } : {}), ...(value.installmentTotal ? { installmentTotal: value.installmentTotal } : {}) };
    }
    case "seriesSegment": {
      const value = item as TransactionSeriesSegment;
      return { seriesId: value.seriesId, effectiveFrom: value.effectiveFrom, anchorDueDate: value.anchorDueDate, profileId: value.profileId, description: value.description, amountCents: value.amountCents, type: value.type, categoryId: value.categoryId, categoryName: value.categoryName, notes: value.notes };
    }
    case "transaction": {
      const value = item as Transaction;
      return {
        profileId: value.profileId,
        ...(value.seriesId ? { seriesId: value.seriesId } : {}),
        ...(value.seriesEndDate ? { seriesEndDate: value.seriesEndDate } : {}),
        occurrenceKey: value.occurrenceKey,
        description: value.description,
        amountCents: value.amountCents,
        type: value.type,
        status: value.status,
        dueDate: value.dueDate,
        categoryId: value.categoryId,
        categoryName: value.categoryName,
        notes: value.notes,
        kind: value.kind,
        ...(value.installmentCurrent ? { installmentCurrent: value.installmentCurrent } : {}),
        ...(value.installmentTotal ? { installmentTotal: value.installmentTotal } : {}),
        ...(value.paidAt ? { paidAt: value.paidAt } : {}),
      };
    }
    case "calculator": {
      const value = item as CalculatorEntry;
      return { expression: value.expression, result: value.result, createdAt: value.createdAt };
    }
  }
}

export function payloadFromServer(
  entityType: SyncEntityType,
  recordId: string,
  ownerUid: string,
  payload: Record<string, unknown>,
  metadata: { version: number; revision: number; isDeleted: boolean; deletedAt?: string; serverTime: string },
  current?: SyncPayload,
): SyncPayload {
  const base = {
    ...payload,
    id: recordId,
    ownerUid,
    localVersion: current?.localVersion ?? 0,
    serverVersion: metadata.version,
    serverRevision: metadata.revision,
    isDeleted: metadata.isDeleted,
    deletedAt: metadata.deletedAt,
  };
  if (entityType === "category") return { ...base, canonicalKey: `${payload.type}:${String(payload.name).trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "")}` } as Category;
  if (entityType === "calculator") return base as CalculatorEntry;
  return {
    ...base,
    createdAt: (current as { createdAt?: string } | undefined)?.createdAt ?? metadata.serverTime,
    updatedAt: metadata.serverTime,
  } as SyncPayload;
}

export function sameServerPayload(entityType: SyncEntityType, left: SyncPayload, right: SyncPayload) {
  return JSON.stringify(payloadForServer(entityType, left)) === JSON.stringify(payloadForServer(entityType, right));
}
