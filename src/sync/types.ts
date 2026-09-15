import type {
  CalculatorEntry,
  Category,
  FinancialProfile,
  Transaction,
  TransactionSeries,
  TransactionSeriesSegment,
} from "../domain/models";

export type SyncEntityType =
  | "transaction"
  | "category"
  | "calculator"
  | "profile"
  | "series"
  | "seriesSegment";

export type SyncOperation = "upsert" | "delete";

export type SyncPayload =
  | Transaction
  | Category
  | CalculatorEntry
  | FinancialProfile
  | TransactionSeries
  | TransactionSeriesSegment;

export type OutboxEntry = {
  id: string;
  ownerUid: string;
  mutationId: string;
  entityType: SyncEntityType;
  recordId: string;
  operation: SyncOperation;
  baseVersion: number;
  payload: SyncPayload;
  baseSnapshot?: SyncPayload;
  fingerprint: string;
  createdAt: string;
};

export type SyncState = {
  ownerUid: string;
  deviceId: string;
  cursor: number;
  epoch: number;
  enabled: boolean;
  lastSyncedAt?: string;
};

export type SyncBaseSnapshot = {
  id: string;
  ownerUid: string;
  entityType: SyncEntityType;
  recordId: string;
  serverVersion: number;
  payload: SyncPayload;
};

export type SyncConflict = {
  id: string;
  ownerUid: string;
  entityType: SyncEntityType;
  recordId: string;
  mutationId: string;
  base?: SyncPayload;
  local: SyncPayload;
  remote: SyncPayload;
  conflictingFields: string[];
  createdAt: string;
};
