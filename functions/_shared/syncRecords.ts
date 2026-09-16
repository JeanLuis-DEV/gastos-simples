import type { D1Database, D1PreparedStatement, Env } from "../types";
import { HttpError } from "./http";
import { contentHash, decryptPayload, encryptPayload, type EncryptedPayload } from "./syncCrypto";
import type { SyncEntityType } from "./syncValidation";

export type RemoteRow = {
  record_id: string;
  version: number;
  revision: number;
  is_deleted: number;
  deleted_at: string | null;
  payload_ciphertext: string;
  payload_iv: string;
  key_id: string;
};

export type StoredRecord = {
  entityType: SyncEntityType;
  recordId: string;
  version: number;
  revision: number;
  isDeleted: boolean;
  deletedAt?: string;
  payload: Record<string, unknown>;
};

export type PlannedRecord = StoredRecord & { previousVersion: number; mutationId: string };

const tables: Record<SyncEntityType, string> = {
  profile: "sync_profiles",
  category: "sync_categories",
  series: "sync_series",
  seriesSegment: "sync_series_segments",
  transaction: "sync_transactions",
  calculator: "sync_calculator_entries",
};

export function tableFor(entityType: SyncEntityType) {
  return tables[entityType];
}

async function decodeRow(env: Env, ownerUid: string, entityType: SyncEntityType, row: RemoteRow): Promise<StoredRecord> {
  return {
    entityType,
    recordId: row.record_id,
    version: row.version,
    revision: row.revision,
    isDeleted: row.is_deleted === 1,
    deletedAt: row.deleted_at ?? undefined,
    payload: await decryptPayload<Record<string, unknown>>(env, ownerUid, entityType, row.record_id, {
      payloadCiphertext: row.payload_ciphertext,
      payloadIv: row.payload_iv,
      keyId: row.key_id,
    }),
  };
}

export async function loadStoredRecord(env: Env, ownerUid: string, entityType: SyncEntityType, recordId: string): Promise<StoredRecord | undefined> {
  const row = await env.DB.prepare(
    `SELECT record_id,version,revision,is_deleted,deleted_at,payload_ciphertext,payload_iv,key_id FROM ${tableFor(entityType)} WHERE firebase_uid=? AND record_id=?`,
  ).bind(ownerUid, recordId).first<RemoteRow>();
  return row ? decodeRow(env, ownerUid, entityType, row) : undefined;
}

export async function loadStoredRecords(env: Env, ownerUid: string, entityType: SyncEntityType, recordIds: string[]) {
  if (!recordIds.length) return [];
  const rows = await env.DB.prepare(
    `SELECT record_id,version,revision,is_deleted,deleted_at,payload_ciphertext,payload_iv,key_id FROM ${tableFor(entityType)} WHERE firebase_uid=? AND record_id IN (SELECT value FROM json_each(?))`,
  ).bind(ownerUid, JSON.stringify(recordIds)).all<RemoteRow>();
  return Promise.all((rows.results ?? []).map((row) => decodeRow(env, ownerUid, entityType, row)));
}

function normalizedCategoryKey(name: unknown, type: unknown) {
  return `${String(type)}:${String(name).trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "")}`;
}

export function structuralFields(entityType: SyncEntityType, payload: Record<string, unknown>) {
  switch (entityType) {
    case "profile":
    case "calculator": return { columns: [] as string[], values: [] as unknown[] };
    case "category": return { columns: ["canonical_key", "transaction_type"], values: [normalizedCategoryKey(payload.name, payload.type), payload.type] };
    case "series": return { columns: ["kind", "start_date", "end_before", "installment_total"], values: [payload.kind, payload.startDate, payload.endBefore ?? null, payload.installmentTotal ?? null] };
    case "seriesSegment": return {
      columns: ["series_id", "effective_from", "anchor_due_date", "profile_id", "category_id", "transaction_type"],
      values: [payload.seriesId, payload.effectiveFrom, payload.anchorDueDate, payload.profileId, payload.categoryId, payload.type],
    };
    case "transaction": return {
      columns: ["profile_id", "category_id", "series_id", "occurrence_key", "due_date", "kind", "transaction_type"],
      values: [payload.profileId, payload.categoryId, payload.seriesId ?? null, payload.occurrenceKey, payload.dueDate, payload.kind, payload.type],
    };
  }
}

export async function recordWriteStatements(
  env: Env,
  ownerUid: string,
  records: PlannedRecord[],
  now: string,
): Promise<D1PreparedStatement[]> {
  if (!records.length) return [];
  const prepared = await Promise.all(records.map(async (record) => ({
    record,
    fields: structuralFields(record.entityType, record.payload),
    encrypted: await encryptPayload(env, ownerUid, record.entityType, record.recordId, record.payload),
  })));
  const statements: D1PreparedStatement[] = [];
  const writeOrder: SyncEntityType[] = ["profile", "category", "series", "seriesSegment", "transaction", "calculator"];
  for (const entityType of writeOrder.filter((candidate) => records.some((record) => record.entityType === candidate))) {
    const group = prepared.filter((item) => item.record.entityType === entityType);
    const fieldColumns = group[0]!.fields.columns;
    const columns = ["firebase_uid", "record_id", ...fieldColumns, "version", "revision", "is_deleted", "deleted_at", "payload_ciphertext", "payload_iv", "key_id", "created_at", "updated_at"];
    const jsonColumns = columns.slice(1);
    const rows = group.map(({ record, fields, encrypted }) => Object.fromEntries([
      ["record_id", record.recordId],
      ...fieldColumns.map((column, index) => [column, fields.values[index]]),
      ["version", record.version], ["revision", record.revision], ["is_deleted", record.isDeleted ? 1 : 0], ["deleted_at", record.deletedAt ?? null],
      ["payload_ciphertext", encrypted.payloadCiphertext], ["payload_iv", encrypted.payloadIv], ["key_id", encrypted.keyId], ["created_at", now], ["updated_at", now],
    ]));
    const updates = [...fieldColumns, "version", "revision", "is_deleted", "deleted_at", "payload_ciphertext", "payload_iv", "key_id", "updated_at"]
      .map((column) => `${column}=excluded.${column}`).join(",");
    statements.push(env.DB.prepare(`INSERT INTO ${tableFor(entityType)} (${columns.join(",")}) SELECT ?,${jsonColumns.map((column) => `json_extract(value,'$.${column}')`).join(",")} FROM json_each(?) WHERE true ON CONFLICT(firebase_uid,record_id) DO UPDATE SET ${updates}`).bind(ownerUid, JSON.stringify(rows)));
  }
  const changeRows = prepared.map(({ record, encrypted }) => ({ revision: record.revision, entity_type: record.entityType, record_id: record.recordId, version: record.version, is_deleted: record.isDeleted ? 1 : 0, deleted_at: record.deletedAt ?? null, payload_ciphertext: encrypted.payloadCiphertext, payload_iv: encrypted.payloadIv, key_id: encrypted.keyId, changed_at: now }));
  statements.push(env.DB.prepare("INSERT INTO sync_changes (firebase_uid,revision,entity_type,record_id,version,is_deleted,deleted_at,payload_ciphertext,payload_iv,key_id,changed_at) SELECT ?,json_extract(value,'$.revision'),json_extract(value,'$.entity_type'),json_extract(value,'$.record_id'),json_extract(value,'$.version'),json_extract(value,'$.is_deleted'),json_extract(value,'$.deleted_at'),json_extract(value,'$.payload_ciphertext'),json_extract(value,'$.payload_iv'),json_extract(value,'$.key_id'),json_extract(value,'$.changed_at') FROM json_each(?)")
    .bind(ownerUid, JSON.stringify(changeRows)));
  const deleted = records.filter((record) => record.isDeleted);
  if (deleted.length) statements.push(env.DB.prepare("INSERT INTO sync_tombstones (firebase_uid,entity_type,record_id,version,revision,deleted_at) SELECT ?,json_extract(value,'$.entity_type'),json_extract(value,'$.record_id'),json_extract(value,'$.version'),json_extract(value,'$.revision'),json_extract(value,'$.deleted_at') FROM json_each(?) WHERE true ON CONFLICT(firebase_uid,entity_type,record_id) DO UPDATE SET version=excluded.version,revision=excluded.revision,deleted_at=excluded.deleted_at")
    .bind(ownerUid, JSON.stringify(deleted.map((record) => ({ entity_type: record.entityType, record_id: record.recordId, version: record.version, revision: record.revision, deleted_at: record.deletedAt })))));
  const active = records.filter((record) => !record.isDeleted);
  if (active.length) statements.push(env.DB.prepare("DELETE FROM sync_tombstones WHERE firebase_uid=? AND EXISTS (SELECT 1 FROM json_each(?) WHERE json_extract(value,'$.entity_type')=sync_tombstones.entity_type AND json_extract(value,'$.record_id')=sync_tombstones.record_id)")
    .bind(ownerUid, JSON.stringify(active.map((record) => ({ entity_type: record.entityType, record_id: record.recordId })))));
  const snapshotRows = prepared.map(({ record, encrypted }) => ({ entity_type: record.entityType, record_id: record.recordId, server_version: record.version, payload_ciphertext: encrypted.payloadCiphertext, payload_iv: encrypted.payloadIv, key_id: encrypted.keyId, created_at: now }));
  statements.push(env.DB.prepare("INSERT INTO sync_base_snapshots (firebase_uid,entity_type,record_id,server_version,payload_ciphertext,payload_iv,key_id,created_at) SELECT ?,json_extract(value,'$.entity_type'),json_extract(value,'$.record_id'),json_extract(value,'$.server_version'),json_extract(value,'$.payload_ciphertext'),json_extract(value,'$.payload_iv'),json_extract(value,'$.key_id'),json_extract(value,'$.created_at') FROM json_each(?) WHERE true ON CONFLICT(firebase_uid,entity_type,record_id) DO UPDATE SET server_version=excluded.server_version,payload_ciphertext=excluded.payload_ciphertext,payload_iv=excluded.payload_iv,key_id=excluded.key_id,created_at=excluded.created_at")
    .bind(ownerUid, JSON.stringify(snapshotRows)));
  statements.push(env.DB.prepare("UPDATE sync_conflicts SET resolved_at=? WHERE firebase_uid=? AND resolved_at IS NULL AND EXISTS (SELECT 1 FROM json_each(?) WHERE json_extract(value,'$.entity_type')=sync_conflicts.entity_type AND json_extract(value,'$.record_id')=sync_conflicts.record_id)")
    .bind(now, ownerUid, JSON.stringify(records.map((record) => ({ entity_type: record.entityType, record_id: record.recordId })))));
  return statements;
}

export async function validateReferences(
  env: Env,
  ownerUid: string,
  entityType: SyncEntityType,
  payload: Record<string, unknown>,
  planned: Map<string, PlannedRecord>,
  known = new Map<string, StoredRecord>(),
) {
  if (!["transaction", "seriesSegment"].includes(entityType)) return;
  const resolve = async (type: SyncEntityType, id: string) => planned.get(`${type}:${id}`) ?? known.get(`${type}:${id}`) ?? loadStoredRecord(env, ownerUid, type, id);
  const profile = await resolve("profile", String(payload.profileId));
  const category = await resolve("category", String(payload.categoryId));
  if (!profile || profile.isDeleted || !category || category.isDeleted || category.payload.type !== payload.type || category.payload.name !== payload.categoryName)
    throw new HttpError(409, "Referências do registro são inválidas.");
  if (payload.seriesId) {
    const series = await resolve("series", String(payload.seriesId));
    if (!series || series.isDeleted || series.payload.kind !== (entityType === "transaction" ? payload.kind : series.payload.kind))
      throw new HttpError(409, "Referência de série inválida.");
  } else if (entityType === "seriesSegment") throw new HttpError(409, "Referência de série inválida.");
}

export function threeWayMergePayload(base: Record<string, unknown>, local: Record<string, unknown>, remote: Record<string, unknown>) {
  const value = { ...remote };
  const conflicts: string[] = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  for (const key of keys) {
    const localChanged = !Object.is(base[key], local[key]);
    const remoteChanged = !Object.is(base[key], remote[key]);
    if (localChanged && remoteChanged && !Object.is(local[key], remote[key])) conflicts.push(key);
    else if (localChanged && !remoteChanged) value[key] = local[key];
  }
  return { value, conflicts: conflicts.sort() };
}

export async function encryptEnvelope(env: Env, ownerUid: string, entityType: SyncEntityType, recordId: string, payload: unknown): Promise<EncryptedPayload> {
  return encryptPayload(env, ownerUid, `conflict:${entityType}`, recordId, payload);
}

export async function listRows(db: D1Database, ownerUid: string, entityType: SyncEntityType, includeDeleted = true) {
  const result = await db.prepare(
    `SELECT record_id,version,revision,is_deleted,deleted_at,payload_ciphertext,payload_iv,key_id FROM ${tableFor(entityType)} WHERE firebase_uid=?${includeDeleted ? "" : " AND is_deleted=0"} ORDER BY revision,record_id`,
  ).bind(ownerUid).all<RemoteRow>();
  return result.results ?? [];
}

export async function loadAllStoredRecords(env: Env, ownerUid: string, entityType: SyncEntityType, includeDeleted = false) {
  const rows = await listRows(env.DB, ownerUid, entityType, includeDeleted);
  return Promise.all(rows.map((row) => decodeRow(env, ownerUid, entityType, row)));
}
