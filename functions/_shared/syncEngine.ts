import type { AuthIdentity, D1PreparedStatement, Env } from "../types";
import { HttpError } from "./http";
import { canonicalJson, contentHash, decryptPayload } from "./syncCrypto";
import {
  encryptEnvelope,
  loadAllStoredRecords,
  loadStoredRecord,
  loadStoredRecords,
  recordWriteStatements,
  tableFor,
  threeWayMergePayload,
  validateReferences,
  type PlannedRecord,
  type StoredRecord,
} from "./syncRecords";
import {
  MAX_PULL_BYTES,
  type PushCommand,
  type PushRequest,
  type ImportReplaceCommand,
  type ProfileTransferCommand,
  type RecordCommand,
  type ResetCommand,
  type RestructureSeriesCommand,
  type SeriesFutureCommand,
  type SyncEntityType,
  validateEntityPayload,
} from "./syncValidation";

type OperationResult = {
  mutationId: string;
  status: "applied" | "merged" | "conflict" | "remote_deleted" | "aliased" | "already_applied";
  records?: Array<{ entityType: SyncEntityType; recordId: string; version: number; revision: number; isDeleted: boolean }>;
  conflictId?: string;
  conflictingFields?: string[];
  canonicalRecordId?: string;
};

type ConflictPlan = {
  operation: RecordCommand;
  conflictId: string;
  fields: string[];
  base?: Record<string, unknown>;
  local: Record<string, unknown>;
  remote: Record<string, unknown>;
};

const key = (entityType: SyncEntityType, recordId: string) => `${entityType}:${recordId}`;
const entities: SyncEntityType[] = ["profile", "category", "series", "seriesSegment", "transaction", "calculator"];
type KnownIdentities = { occurrences: Map<string, string>; categories: Map<string, string> };

async function trimCalculatorHistory(env: Env, ownerUid: string, planned: Map<string, PlannedRecord>, mutationId: string, deletedAt: string) {
  const active = new Map((await loadAllStoredRecords(env, ownerUid, "calculator")).map((record) => [record.recordId, record]));
  for (const record of planned.values()) {
    if (record.entityType !== "calculator") continue;
    if (record.isDeleted) active.delete(record.recordId);
    else active.set(record.recordId, record);
  }
  const excess = [...active.values()]
    .sort((left, right) => String(right.payload.createdAt).localeCompare(String(left.payload.createdAt)) || right.recordId.localeCompare(left.recordId))
    .slice(100);
  for (const record of excess) {
    const pending = planned.get(key("calculator", record.recordId));
    planned.set(key("calculator", record.recordId), {
      ...record,
      previousVersion: pending?.previousVersion ?? record.version,
      version: pending?.version ?? record.version + 1,
      revision: 0,
      isDeleted: true,
      deletedAt,
      mutationId: pending?.mutationId ?? mutationId,
    });
  }
}

async function preloadGenericState(env: Env, ownerUid: string, operations: PushCommand[]) {
  const ids = new Map<SyncEntityType, Set<string>>(entities.map((entity) => [entity, new Set()]));
  const occurrenceKeys = new Set<string>();
  const categoryKeys = new Set<string>();
  for (const operation of operations) {
    if (operation.command !== "upsert-record" && operation.command !== "delete-record") continue;
    ids.get(operation.entityType)!.add(operation.recordId);
    const payloads = [operation.payload, operation.baseSnapshot].filter(Boolean) as Record<string, unknown>[];
    for (const payload of payloads) {
      if (payload.profileId) ids.get("profile")!.add(String(payload.profileId));
      if (payload.categoryId) ids.get("category")!.add(String(payload.categoryId));
      if (payload.seriesId) ids.get("series")!.add(String(payload.seriesId));
    }
    if (operation.entityType === "transaction" && operation.payload?.occurrenceKey) occurrenceKeys.add(String(operation.payload.occurrenceKey));
    if (operation.entityType === "category" && operation.payload)
      categoryKeys.add(`${String(operation.payload.type)}:${String(operation.payload.name).trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "")}`);
  }
  const known = new Map<string, StoredRecord>();
  for (const entityType of entities) {
    for (const record of await loadStoredRecords(env, ownerUid, entityType, [...ids.get(entityType)!])) known.set(key(entityType, record.recordId), record);
  }
  const identities: KnownIdentities = { occurrences: new Map(), categories: new Map() };
  if (occurrenceKeys.size) {
    const rows = await env.DB.prepare("SELECT occurrence_key,record_id FROM sync_transactions WHERE firebase_uid=? AND occurrence_key IN (SELECT value FROM json_each(?))")
      .bind(ownerUid, JSON.stringify([...occurrenceKeys])).all<{ occurrence_key: string; record_id: string }>();
    for (const row of rows.results ?? []) identities.occurrences.set(row.occurrence_key, row.record_id);
  }
  if (categoryKeys.size) {
    const rows = await env.DB.prepare("SELECT canonical_key,record_id FROM sync_categories WHERE firebase_uid=? AND canonical_key IN (SELECT value FROM json_each(?))")
      .bind(ownerUid, JSON.stringify([...categoryKeys])).all<{ canonical_key: string; record_id: string }>();
    for (const row of rows.results ?? []) identities.categories.set(row.canonical_key, row.record_id);
  }
  return { known, identities };
}

function addMonthsClamped(date: string, delta: number) {
  const [year, month, day] = date.split("-").map(Number);
  const absolute = year! * 12 + month! - 1 + delta;
  const targetYear = Math.floor(absolute / 12);
  const targetMonth = absolute % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(Math.min(day!, lastDay)).padStart(2, "0")}`;
}

async function duplicateIdentity(record: PlannedRecord, planned: Map<string, PlannedRecord>, identities: KnownIdentities) {
  if (record.entityType === "transaction") {
    const occurrenceKey = String(record.payload.occurrenceKey);
    const duplicatePlanned = [...planned.values()].find((item) => item.entityType === "transaction" && item.recordId !== record.recordId && item.payload.occurrenceKey === occurrenceKey);
    const duplicateStored = identities.occurrences.get(occurrenceKey);
    if (duplicatePlanned || (duplicateStored && duplicateStored !== record.recordId)) return duplicatePlanned?.recordId ?? duplicateStored;
  }
  if (record.entityType === "category") {
    const normalized = `${String(record.payload.type)}:${String(record.payload.name).trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "")}`;
    const duplicateStored = identities.categories.get(normalized);
    const duplicatePlanned = [...planned.values()].find((item) => item.entityType === "category" && item.recordId !== record.recordId && `${String(item.payload.type)}:${String(item.payload.name).trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "")}` === normalized);
    if (duplicatePlanned || (duplicateStored && duplicateStored !== record.recordId)) return duplicatePlanned?.recordId ?? duplicateStored;
  }
  return undefined;
}

async function planRecord(
  env: Env,
  ownerUid: string,
  operation: RecordCommand,
  planned: Map<string, PlannedRecord>,
  conflicts: ConflictPlan[],
  aliases: Array<{ entityType: "category" | "transaction"; aliasId: string; canonicalId: string }>,
  known: Map<string, StoredRecord>,
  identities: KnownIdentities,
) {
  const current = planned.get(key(operation.entityType, operation.recordId)) ?? known.get(key(operation.entityType, operation.recordId));
  if (!current && operation.command === "delete-record") throw new HttpError(409, "Registro inexistente.");
  if (!current && operation.baseVersion !== 0) throw new HttpError(409, "Versão-base inválida.");
  if (current && current.version !== operation.baseVersion) {
    if (current.isDeleted) return { status: "remote_deleted" as const, records: [] };
    if (operation.command === "upsert-record" && operation.baseSnapshot) {
      const merged = threeWayMergePayload(operation.baseSnapshot, operation.payload!, current.payload);
      if (!merged.conflicts.length) {
        validateEntityPayload(operation.entityType, merged.value);
        const next: PlannedRecord = { ...current, payload: merged.value, isDeleted: false, deletedAt: undefined, previousVersion: current.version, version: current.version + 1, revision: 0, mutationId: operation.mutationId };
        await validateReferences(env, ownerUid, operation.entityType, next.payload, planned, known);
        if (await duplicateIdentity(next, planned, identities)) throw new HttpError(409, "A identidade do registro já está em uso.");
        planned.set(key(operation.entityType, operation.recordId), next);
        return { status: "merged" as const, records: [next] };
      }
      const conflictId = `${operation.mutationId}:${operation.entityType}:${operation.recordId}`;
      conflicts.push({ operation, conflictId, fields: merged.conflicts, base: operation.baseSnapshot, local: operation.payload!, remote: current.payload });
      return { status: "conflict" as const, conflictId, conflictingFields: merged.conflicts, records: [] };
    }
    const conflictId = `${operation.mutationId}:${operation.entityType}:${operation.recordId}`;
    conflicts.push({ operation, conflictId, fields: ["version"], base: operation.baseSnapshot, local: operation.payload ?? {}, remote: current.payload });
    return { status: "conflict" as const, conflictId, conflictingFields: ["version"], records: [] };
  }
  const payload = operation.command === "upsert-record" ? operation.payload! : current!.payload;
  const next: PlannedRecord = {
    entityType: operation.entityType,
    recordId: operation.recordId,
    payload,
    previousVersion: current?.version ?? 0,
    version: (current?.version ?? 0) + 1,
    revision: 0,
    isDeleted: operation.command === "delete-record",
    deletedAt: operation.command === "delete-record" ? new Date().toISOString() : undefined,
    mutationId: operation.mutationId,
  };
  if (!next.isDeleted) {
    await validateReferences(env, ownerUid, operation.entityType, payload, planned, known);
    const canonicalId = await duplicateIdentity(next, planned, identities);
    if (canonicalId) {
      if (!current && (operation.entityType === "category" || operation.entityType === "transaction")) {
        aliases.push({ entityType: operation.entityType, aliasId: operation.recordId, canonicalId });
        return { status: "aliased" as const, canonicalRecordId: canonicalId, records: [] };
      }
      throw new HttpError(409, "A identidade do registro já está em uso.");
    }
  }
  planned.set(key(operation.entityType, operation.recordId), next);
  return { status: "applied" as const, records: [next] };
}

async function futureTransactions(env: Env, ownerUid: string, seriesId: string, effectiveFrom: string) {
  const rows = await env.DB.prepare(
    "SELECT record_id FROM sync_transactions WHERE firebase_uid=? AND series_id=? AND due_date>=? ORDER BY due_date,record_id",
  ).bind(ownerUid, seriesId, effectiveFrom).all<{ record_id: string }>();
  return loadStoredRecords(env, ownerUid, "transaction", (rows.results ?? []).map((row) => row.record_id));
}

async function planSeriesFuture(env: Env, ownerUid: string, operation: SeriesFutureCommand, planned: Map<string, PlannedRecord>) {
  const series = planned.get(key("series", operation.recordId)) ?? await loadStoredRecord(env, ownerUid, "series", operation.recordId);
  if (!series || series.isDeleted || series.version !== operation.baseVersion) throw new HttpError(409, "A série foi alterada em outro dispositivo.");
  const affected: PlannedRecord[] = [];
  const nextSeries: PlannedRecord = {
    ...series,
    payload: operation.command === "delete-series-future" ? { ...series.payload, endBefore: operation.effectiveFrom } : series.payload,
    previousVersion: series.version,
    version: series.version + 1,
    revision: 0,
    mutationId: operation.mutationId,
  };
  planned.set(key("series", operation.recordId), nextSeries);
  affected.push(nextSeries);
  const transactions = await futureTransactions(env, ownerUid, operation.recordId, operation.effectiveFrom);
  if (operation.command === "delete-series-future") {
    const deletedAt = new Date().toISOString();
    for (const current of transactions) {
      if (current.isDeleted) continue;
      const next: PlannedRecord = { ...current, previousVersion: current.version, version: current.version + 1, revision: 0, isDeleted: true, deletedAt, mutationId: operation.mutationId };
      planned.set(key("transaction", current.recordId), next);
      affected.push(next);
    }
    return { status: "applied" as const, records: affected };
  }
  const segmentRow = await env.DB.prepare("SELECT record_id FROM sync_series_segments WHERE firebase_uid=? AND series_id=? AND effective_from<=? AND is_deleted=0 ORDER BY effective_from DESC LIMIT 1")
    .bind(ownerUid, operation.recordId, operation.effectiveFrom).first<{ record_id: string }>();
  const template = segmentRow ? await loadStoredRecord(env, ownerUid, "seriesSegment", segmentRow.record_id) : undefined;
  if (!template) throw new HttpError(409, "Segmento-base da série inexistente.");
  const changes = operation.changes!;
  const segmentId = `segment:${operation.recordId}:${operation.effectiveFrom}`;
  const currentSegment = await loadStoredRecord(env, ownerUid, "seriesSegment", segmentId);
  const segmentPayload = { ...template.payload, ...changes, seriesId: operation.recordId, effectiveFrom: operation.effectiveFrom };
  validateEntityPayload("seriesSegment", segmentPayload);
  const nextSegment: PlannedRecord = {
    entityType: "seriesSegment", recordId: segmentId, payload: segmentPayload, previousVersion: currentSegment?.version ?? 0,
    version: (currentSegment?.version ?? 0) + 1, revision: 0, isDeleted: false, mutationId: operation.mutationId,
  };
  await validateReferences(env, ownerUid, "seriesSegment", segmentPayload, planned);
  planned.set(key("seriesSegment", segmentId), nextSegment);
  affected.push(nextSegment);
  const [fromYear, fromMonth] = operation.effectiveFrom.slice(0, 7).split("-").map(Number);
  for (const current of transactions) {
    if (current.isDeleted) continue;
    const payload = { ...current.payload };
    for (const field of ["profileId", "description", "amountCents", "type", "categoryId", "categoryName", "notes"])
      if (changes[field] !== undefined) payload[field] = changes[field];
    if (changes.anchorDueDate) {
      const [year, month] = String(payload.dueDate).slice(0, 7).split("-").map(Number);
      payload.dueDate = addMonthsClamped(String(changes.anchorDueDate), (year! - fromYear!) * 12 + month! - fromMonth!);
      if (payload.kind === "recurring") payload.occurrenceKey = `${operation.recordId}:${String(payload.dueDate).slice(0, 7)}`;
    }
    if (changes.type && payload.status !== "pending") payload.status = changes.type === "expense" ? "paid" : "received";
    validateEntityPayload("transaction", payload);
    const next: PlannedRecord = { ...current, payload, previousVersion: current.version, version: current.version + 1, revision: 0, mutationId: operation.mutationId };
    await validateReferences(env, ownerUid, "transaction", payload, planned);
    if (await duplicateIdentity(next, planned, { occurrences: new Map(), categories: new Map() })) throw new HttpError(409, "A ocorrência já existe.");
    planned.set(key("transaction", current.recordId), next);
    affected.push(next);
  }
  return { status: "applied" as const, records: affected };
}

async function planProfileTransfer(env: Env, ownerUid: string, operation: ProfileTransferCommand, planned: Map<string, PlannedRecord>) {
  const source = await loadStoredRecord(env, ownerUid, "profile", operation.recordId);
  const destination = await loadStoredRecord(env, ownerUid, "profile", operation.destinationProfileId);
  if (!source || source.isDeleted || source.version !== operation.baseVersion || !destination || destination.isDeleted)
    throw new HttpError(409, "Os perfis foram alterados em outro dispositivo.");
  const transactionIds = await env.DB.prepare("SELECT record_id FROM sync_transactions WHERE firebase_uid=? AND profile_id=?")
    .bind(ownerUid, operation.recordId).all<{ record_id: string }>();
  const segmentIds = await env.DB.prepare("SELECT record_id FROM sync_series_segments WHERE firebase_uid=? AND profile_id=?")
    .bind(ownerUid, operation.recordId).all<{ record_id: string }>();
  const linked = [
    ...await loadStoredRecords(env, ownerUid, "transaction", (transactionIds.results ?? []).map(({ record_id }) => record_id)),
    ...await loadStoredRecords(env, ownerUid, "seriesSegment", (segmentIds.results ?? []).map(({ record_id }) => record_id)),
  ];
  const affected: PlannedRecord[] = [];
  for (const current of linked) {
    const next: PlannedRecord = { ...current, payload: { ...current.payload, profileId: operation.destinationProfileId }, previousVersion: current.version, version: current.version + 1, revision: 0, mutationId: operation.mutationId };
    planned.set(key(current.entityType, current.recordId), next);
    affected.push(next);
  }
  const deletedProfile: PlannedRecord = { ...source, previousVersion: source.version, version: source.version + 1, revision: 0, isDeleted: true, deletedAt: new Date().toISOString(), mutationId: operation.mutationId };
  planned.set(key("profile", source.recordId), deletedProfile);
  affected.push(deletedProfile);
  return { status: "applied" as const, records: affected };
}

async function planRestructureSeries(env: Env, ownerUid: string, operation: RestructureSeriesCommand, planned: Map<string, PlannedRecord>) {
  const stopped = await planSeriesFuture(env, ownerUid, {
    command: "delete-series-future",
    mutationId: operation.mutationId,
    entityType: "series",
    recordId: operation.recordId,
    baseVersion: operation.baseVersion,
    effectiveFrom: operation.effectiveFrom,
  }, planned);
  const draft = operation.replacement;
  const kind = String(draft.kind);
  const seriesId = kind === "single" ? undefined : `${operation.mutationId}:series`;
  const count = kind === "installment" ? Number(draft.installmentTotal) : 1;
  const affected = [...stopped.records];
  if (seriesId) {
    const nextSeries: PlannedRecord = {
      entityType: "series", recordId: seriesId, previousVersion: 0, version: 1, revision: 0, isDeleted: false, mutationId: operation.mutationId,
      payload: { kind, startDate: draft.startDate, ...(kind === "installment" ? { installmentTotal: count } : {}) },
    };
    planned.set(key("series", seriesId), nextSeries);
    affected.push(nextSeries);
    const segmentId = `segment:${seriesId}:${String(draft.startDate)}`;
    const segmentPayload = {
      seriesId, effectiveFrom: draft.startDate, anchorDueDate: draft.startDate, profileId: draft.profileId, description: draft.description,
      amountCents: draft.amountCents, type: draft.type, categoryId: draft.categoryId, categoryName: draft.categoryName, notes: draft.notes,
    };
    validateEntityPayload("seriesSegment", segmentPayload);
    const segment: PlannedRecord = { entityType: "seriesSegment", recordId: segmentId, previousVersion: 0, version: 1, revision: 0, isDeleted: false, mutationId: operation.mutationId, payload: segmentPayload };
    await validateReferences(env, ownerUid, "seriesSegment", segmentPayload, planned);
    planned.set(key("seriesSegment", segmentId), segment);
    affected.push(segment);
  }
  for (let index = 0; index < count; index += 1) {
    const recordId = `${operation.mutationId}:occurrence:${index + 1}`;
    const dueDate = addMonthsClamped(String(draft.startDate), index);
    const payload = {
      profileId: draft.profileId,
      ...(seriesId ? { seriesId } : {}),
      occurrenceKey: kind === "single" ? `single:${recordId}` : kind === "recurring" ? `${seriesId}:${dueDate.slice(0, 7)}` : `${seriesId}:${index + 1}`,
      description: draft.description, amountCents: draft.amountCents, type: draft.type,
      status: index === 0 ? draft.status : "pending", dueDate, categoryId: draft.categoryId, categoryName: draft.categoryName, notes: draft.notes, kind,
      ...(kind === "installment" ? { installmentCurrent: index + 1, installmentTotal: count } : {}),
      ...(index === 0 && draft.paidAt ? { paidAt: draft.paidAt } : {}),
    };
    validateEntityPayload("transaction", payload);
    const transaction: PlannedRecord = { entityType: "transaction", recordId, previousVersion: 0, version: 1, revision: 0, isDeleted: false, mutationId: operation.mutationId, payload };
    await validateReferences(env, ownerUid, "transaction", payload, planned);
    if (await duplicateIdentity(transaction, planned, { occurrences: new Map(), categories: new Map() })) throw new HttpError(409, "A ocorrência já existe.");
    planned.set(key("transaction", recordId), transaction);
    affected.push(transaction);
  }
  return { status: "applied" as const, records: affected };
}

const defaultCategories = [
  ["Alimentação", "expense", "alimentacao"], ["Transporte", "expense", "transporte"], ["Moradia", "expense", "moradia"], ["Saúde", "expense", "saude"], ["Educação", "expense", "educacao"], ["Lazer", "expense", "lazer"], ["Vestuário", "expense", "vestuario"], ["Serviços", "expense", "servicos"], ["Contas e Taxas", "expense", "contas-e-taxas"],
  ["Salário", "income", "salario"], ["Freelance", "income", "freelance"], ["Investimentos", "income", "investimentos"], ["Vendas", "income", "vendas"], ["Aluguéis", "income", "alugueis"], ["Rendimentos", "income", "rendimentos"], ["Bônus", "income", "bonus"], ["Reembolso", "income", "reembolso"], ["Doações", "income", "doacoes"],
] as const;

function resetRecords() {
  return [
    { entityType: "profile" as const, recordId: "profile:principal", payload: { name: "Principal" } },
    ...defaultCategories.map(([name, type, slug]) => ({ entityType: "category" as const, recordId: `default:${type}:${slug}`, payload: { name, type, isDefault: true } })),
  ];
}

function financialDeleteStatements(env: Env, ownerUid: string) {
  return ["sync_mutation_receipts", "sync_batches", "sync_changes", "sync_tombstones", "sync_record_aliases", "sync_base_snapshots", "sync_conflicts", "sync_devices", "sync_series_segments", "sync_transactions", "sync_calculator_entries", "sync_series", "sync_categories", "sync_profiles", "sync_retention", "sync_deletion_nonces"]
    .map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE firebase_uid=?`).bind(ownerUid));
}

async function pushReplacement(
  env: Env,
  identity: AuthIdentity,
  body: PushRequest,
  account: { sync_epoch: number; revision: number },
  operation: ResetCommand | ImportReplaceCommand,
  batchHash: string,
) {
  if (operation.baseRevision !== account.revision) throw new HttpError(409, "O estado remoto mudou. Faça uma nova sincronização.");
  const source = operation.command === "reset-account-data" ? resetRecords() : operation.records;
  const planned = new Map<string, PlannedRecord>();
  for (const item of source) {
    const record: PlannedRecord = { entityType: item.entityType, recordId: item.recordId, payload: item.payload, previousVersion: 0, version: 1, revision: planned.size + 1, isDeleted: false, mutationId: operation.mutationId };
    if (planned.has(key(record.entityType, record.recordId))) throw new HttpError(400, "Snapshot contém duplicidades.");
    planned.set(key(record.entityType, record.recordId), record);
  }
  const canonicalCategories = new Set<string>(), occurrences = new Set<string>();
  for (const record of planned.values()) {
    validateEntityPayload(record.entityType, record.payload);
    if (record.entityType === "category") {
      const canonical = `${record.payload.type}:${String(record.payload.name).toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "")}`;
      if (canonicalCategories.has(canonical)) throw new HttpError(400, "Snapshot contém categorias duplicadas.");
      canonicalCategories.add(canonical);
    }
    if (record.entityType === "transaction") {
      const occurrence = String(record.payload.occurrenceKey);
      if (occurrences.has(occurrence)) throw new HttpError(400, "Snapshot contém ocorrências duplicadas.");
      occurrences.add(occurrence);
    }
  }
  for (const record of planned.values()) await validateReferences(env, identity.uid, record.entityType, record.payload, planned, planned);
  const nextEpoch = account.sync_epoch + 1;
  const now = new Date().toISOString();
  const result: OperationResult = { mutationId: operation.mutationId, status: "applied", records: [...planned.values()].map((record) => ({ entityType: record.entityType, recordId: record.recordId, version: 1, revision: record.revision, isDeleted: false })) };
  const response = { protocolVersion: 1, batchId: body.batchId, syncEpoch: nextEpoch, committedRevision: planned.size, highWatermark: planned.size, serverTime: now, results: [result] };
  const guardId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO sync_write_guards (firebase_uid,request_id,valid) SELECT ?,?,CASE WHEN EXISTS(SELECT 1 FROM sync_accounts WHERE firebase_uid=? AND sync_epoch=? AND revision=? AND activated_at IS NOT NULL AND disabled_at IS NULL) THEN 1 ELSE 0 END").bind(identity.uid, guardId, identity.uid, account.sync_epoch, account.revision),
    ...financialDeleteStatements(env, identity.uid),
    ...await recordWriteStatements(env, identity.uid, [...planned.values()], now),
    env.DB.prepare("UPDATE sync_accounts SET sync_epoch=?,revision=?,min_available_revision=0,updated_at=? WHERE firebase_uid=?").bind(nextEpoch, planned.size, now, identity.uid),
    env.DB.prepare("INSERT INTO sync_devices (firebase_uid,device_id,protocol_version,created_at,last_seen_at) VALUES (?,?,?,?,?)").bind(identity.uid, body.deviceId, body.protocolVersion, now, now),
    env.DB.prepare("INSERT INTO sync_batches (firebase_uid,batch_id,content_hash,response_json,created_at) VALUES (?,?,?,?,?)").bind(identity.uid, body.batchId, batchHash, canonicalJson(response), now),
    env.DB.prepare("INSERT INTO sync_mutation_receipts (firebase_uid,mutation_id,batch_id,content_hash,result_json,created_at) VALUES (?,?,?,?,?,?)").bind(identity.uid, operation.mutationId, body.batchId, await contentHash(operation), canonicalJson(result), now),
    env.DB.prepare("DELETE FROM sync_write_guards WHERE firebase_uid=? AND request_id=?").bind(identity.uid, guardId),
  ];
  try { await env.DB.batch(statements); }
  catch { throw new HttpError(409, "Os dados mudaram durante a substituição. Tente novamente."); }
  return response;
}

async function persistConflicts(env: Env, ownerUid: string, conflicts: ConflictPlan[], now: string) {
  if (!conflicts.length) return undefined;
  const values = await Promise.all(conflicts.map(async (conflict) => ({
    conflict,
    encrypted: await encryptEnvelope(env, ownerUid, conflict.operation.entityType, conflict.conflictId, { base: conflict.base, local: conflict.local, remote: conflict.remote }),
  })));
  return env.DB.prepare(
    "INSERT INTO sync_conflicts (firebase_uid,conflict_id,mutation_id,entity_type,record_id,conflicting_fields_json,payload_ciphertext,payload_iv,key_id,created_at) SELECT ?,json_extract(value,'$.conflict_id'),json_extract(value,'$.mutation_id'),json_extract(value,'$.entity_type'),json_extract(value,'$.record_id'),json_extract(value,'$.conflicting_fields_json'),json_extract(value,'$.payload_ciphertext'),json_extract(value,'$.payload_iv'),json_extract(value,'$.key_id'),json_extract(value,'$.created_at') FROM json_each(?) WHERE true ON CONFLICT(firebase_uid,conflict_id) DO NOTHING",
  ).bind(ownerUid, JSON.stringify(values.map(({ conflict, encrypted }) => ({ conflict_id: conflict.conflictId, mutation_id: conflict.operation.mutationId, entity_type: conflict.operation.entityType, record_id: conflict.operation.recordId, conflicting_fields_json: JSON.stringify(conflict.fields), payload_ciphertext: encrypted.payloadCiphertext, payload_iv: encrypted.payloadIv, key_id: encrypted.keyId, created_at: now }))));
}

export async function pushSync(env: Env, identity: AuthIdentity, body: PushRequest) {
  const account = await env.DB.prepare("SELECT sync_epoch,revision,activated_at,disabled_at FROM sync_accounts WHERE firebase_uid=?")
    .bind(identity.uid).first<{ sync_epoch: number; revision: number; activated_at: string | null; disabled_at: string | null }>();
  if (!account?.activated_at || account.disabled_at) throw new HttpError(409, "Ative a sincronização antes de enviar dados.");
  const batchHash = await contentHash(body);
  const previousBatch = await env.DB.prepare("SELECT content_hash,response_json FROM sync_batches WHERE firebase_uid=? AND batch_id=?")
    .bind(identity.uid, body.batchId).first<{ content_hash: string; response_json: string }>();
  if (previousBatch) {
    if (previousBatch.content_hash !== batchHash) throw new HttpError(409, "O lote já foi usado com outro conteúdo.");
    return JSON.parse(previousBatch.response_json) as Record<string, unknown>;
  }
  if (account.sync_epoch !== body.syncEpoch) throw new HttpError(410, "resync_required");
  const collective = body.operations[0];
  if (collective?.command === "reset-account-data" || collective?.command === "import-replace")
    return pushReplacement(env, identity, body, account, collective, batchHash);
  const planned = new Map<string, PlannedRecord>();
  const conflicts: ConflictPlan[] = [];
  const aliases: Array<{ entityType: "category" | "transaction"; aliasId: string; canonicalId: string }> = [];
  const { known, identities } = await preloadGenericState(env, identity.uid, body.operations);
  const results: OperationResult[] = [];
  const newOperations: Array<{ operation: PushCommand; hash: string; result: OperationResult }> = [];
  const receiptRows = await env.DB.prepare("SELECT mutation_id,content_hash,result_json FROM sync_mutation_receipts WHERE firebase_uid=? AND mutation_id IN (SELECT value FROM json_each(?))")
    .bind(identity.uid, JSON.stringify(body.operations.map((operation) => operation.mutationId)))
    .all<{ mutation_id: string; content_hash: string; result_json: string }>();
  const receipts = new Map((receiptRows.results ?? []).map((receipt) => [receipt.mutation_id, receipt]));
  const operationOrder = new Map<SyncEntityType, number>(entities.map((entity, index) => [entity, index]));
  const orderedOperations = [...body.operations].sort((left, right) => {
    if ((left.command !== "upsert-record" && left.command !== "delete-record") || (right.command !== "upsert-record" && right.command !== "delete-record")) return 0;
    return operationOrder.get(left.entityType)! - operationOrder.get(right.entityType)!;
  });
  for (const operation of orderedOperations) {
    const hash = await contentHash(operation);
    const receipt = receipts.get(operation.mutationId);
    if (receipt) {
      if (receipt.content_hash !== hash) throw new HttpError(409, "A mutação já foi usada com outro conteúdo.");
      const prior = JSON.parse(receipt.result_json) as OperationResult;
      results.push({ ...prior, status: "already_applied" });
      continue;
    }
    let outcome;
    if (operation.command === "upsert-record" || operation.command === "delete-record") outcome = await planRecord(env, identity.uid, operation, planned, conflicts, aliases, known, identities);
    else if (operation.command === "edit-series-future" || operation.command === "delete-series-future") outcome = await planSeriesFuture(env, identity.uid, operation, planned);
    else if (operation.command === "delete-profile-and-transfer") outcome = await planProfileTransfer(env, identity.uid, operation, planned);
    else if (operation.command === "restructure-series") outcome = await planRestructureSeries(env, identity.uid, operation, planned);
    else throw new HttpError(400, "Comando inválido.");
    const result: OperationResult = { mutationId: operation.mutationId, status: outcome.status, conflictId: "conflictId" in outcome ? outcome.conflictId : undefined, conflictingFields: "conflictingFields" in outcome ? outcome.conflictingFields : undefined, canonicalRecordId: "canonicalRecordId" in outcome ? outcome.canonicalRecordId : undefined };
    results.push(result);
    newOperations.push({ operation, hash, result });
  }
  const now = new Date().toISOString();
  const calculatorUpsert = newOperations.find(({ operation }) => operation.command === "upsert-record" && operation.entityType === "calculator");
  if (calculatorUpsert) await trimCalculatorHistory(env, identity.uid, planned, calculatorUpsert.operation.mutationId, now);
  let revision = account.revision;
  for (const record of planned.values()) record.revision = ++revision;
  for (const item of newOperations) {
    const records = [...planned.values()].filter((record) => record.mutationId === item.operation.mutationId);
    if (records.length) item.result.records = records.map((record) => ({ entityType: record.entityType, recordId: record.recordId, version: record.version, revision: record.revision, isDeleted: record.isDeleted }));
  }
  const response = { protocolVersion: 1, batchId: body.batchId, syncEpoch: account.sync_epoch, committedRevision: revision, highWatermark: revision, serverTime: now, results };
  const guardId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO sync_write_guards (firebase_uid,request_id,valid) SELECT ?,?,CASE WHEN EXISTS(SELECT 1 FROM sync_accounts WHERE firebase_uid=? AND sync_epoch=? AND revision=? AND activated_at IS NOT NULL AND disabled_at IS NULL) THEN 1 ELSE 0 END")
      .bind(identity.uid, guardId, identity.uid, account.sync_epoch, account.revision),
    env.DB.prepare("INSERT INTO sync_devices (firebase_uid,device_id,protocol_version,created_at,last_seen_at) VALUES (?,?,?,?,?) ON CONFLICT(firebase_uid,device_id) DO UPDATE SET protocol_version=excluded.protocol_version,last_seen_at=excluded.last_seen_at")
      .bind(identity.uid, body.deviceId, body.protocolVersion, now, now),
  ];
  statements.push(...await recordWriteStatements(env, identity.uid, [...planned.values()], now));
  const conflictStatement = await persistConflicts(env, identity.uid, conflicts, now);
  if (conflictStatement) statements.push(conflictStatement);
  if (aliases.length) statements.push(env.DB.prepare("INSERT INTO sync_record_aliases (firebase_uid,entity_type,alias_id,canonical_id,created_at) SELECT ?,json_extract(value,'$.entity_type'),json_extract(value,'$.alias_id'),json_extract(value,'$.canonical_id'),json_extract(value,'$.created_at') FROM json_each(?) WHERE true ON CONFLICT(firebase_uid,entity_type,alias_id) DO UPDATE SET canonical_id=excluded.canonical_id,created_at=excluded.created_at")
    .bind(identity.uid, JSON.stringify(aliases.map((alias) => ({ entity_type: alias.entityType, alias_id: alias.aliasId, canonical_id: alias.canonicalId, created_at: now })))));
  statements.push(env.DB.prepare("UPDATE sync_accounts SET revision=?,updated_at=? WHERE firebase_uid=?").bind(revision, now, identity.uid));
  statements.push(env.DB.prepare("INSERT INTO sync_batches (firebase_uid,batch_id,content_hash,response_json,created_at) VALUES (?,?,?,?,?)").bind(identity.uid, body.batchId, batchHash, canonicalJson(response), now));
  if (newOperations.length)
    statements.push(env.DB.prepare("INSERT INTO sync_mutation_receipts (firebase_uid,mutation_id,batch_id,content_hash,result_json,created_at) SELECT ?,json_extract(value,'$.mutation_id'),json_extract(value,'$.batch_id'),json_extract(value,'$.content_hash'),json_extract(value,'$.result_json'),json_extract(value,'$.created_at') FROM json_each(?)")
      .bind(identity.uid, JSON.stringify(newOperations.map((item) => ({ mutation_id: item.operation.mutationId, batch_id: body.batchId, content_hash: item.hash, result_json: canonicalJson(item.result), created_at: now })))));
  statements.push(env.DB.prepare("DELETE FROM sync_write_guards WHERE firebase_uid=? AND request_id=?").bind(identity.uid, guardId));
  try {
    await env.DB.batch(statements);
  } catch {
    throw new HttpError(409, "Os dados mudaram durante a sincronização. Tente novamente.");
  }
  return response;
}

export async function pullSync(env: Env, ownerUid: string, input: { cursor: number; untilRevision?: number; limit: number; epoch: number; deviceId: string; protocolVersion: number }) {
  const account = await env.DB.prepare("SELECT sync_epoch,revision,min_available_revision,activated_at,disabled_at FROM sync_accounts WHERE firebase_uid=?")
    .bind(ownerUid).first<{ sync_epoch: number; revision: number; min_available_revision: number; activated_at: string | null; disabled_at: string | null }>();
  if (!account?.activated_at || account.disabled_at) throw new HttpError(409, "A sincronização não está ativa.");
  if (account.sync_epoch !== input.epoch) throw new HttpError(410, "resync_required");
  const highWatermark = input.untilRevision ?? account.revision;
  if (highWatermark < input.cursor || highWatermark > account.revision) throw new HttpError(400, "Cursor de sincronização inválido.");
  if (input.cursor > 0 && input.cursor < account.min_available_revision) throw new HttpError(410, "resync_required");
  const changes = await env.DB.prepare("SELECT revision,entity_type,record_id,version,is_deleted,deleted_at,payload_ciphertext,payload_iv,key_id FROM sync_changes WHERE firebase_uid=? AND revision>? AND revision<=? ORDER BY revision LIMIT ?")
    .bind(ownerUid, input.cursor, highWatermark, input.limit).all<{ revision: number; entity_type: SyncEntityType; record_id: string; version: number; is_deleted: number; deleted_at: string | null; payload_ciphertext: string; payload_iv: string; key_id: string }>();
  const records: Array<Record<string, unknown>> = [];
  let nextCursor = input.cursor;
  for (const change of changes.results ?? []) {
    const payload = await decryptPayload<Record<string, unknown>>(env, ownerUid, change.entity_type, change.record_id, {
      payloadCiphertext: change.payload_ciphertext,
      payloadIv: change.payload_iv,
      keyId: change.key_id,
    });
    const candidate = { entityType: change.entity_type, recordId: change.record_id, version: change.version, revision: change.revision, isDeleted: change.is_deleted === 1, deletedAt: change.deleted_at ?? undefined, payload };
    const candidateResponse = { protocolVersion: 1, syncEpoch: account.sync_epoch, highWatermark, cursor: change.revision, hasMore: change.revision < highWatermark, records: [...records, candidate] };
    if (new TextEncoder().encode(canonicalJson(candidateResponse)).byteLength > MAX_PULL_BYTES) break;
    records.push(candidate);
    nextCursor = change.revision;
  }
  const fetched = changes.results ?? [];
  if (records.length === fetched.length && fetched.length < input.limit) nextCursor = highWatermark;
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO sync_devices (firebase_uid,device_id,protocol_version,created_at,last_seen_at) VALUES (?,?,?,?,?) ON CONFLICT(firebase_uid,device_id) DO UPDATE SET protocol_version=excluded.protocol_version,last_seen_at=excluded.last_seen_at")
    .bind(ownerUid, input.deviceId, input.protocolVersion, now, now).run();
  return { protocolVersion: 1, syncEpoch: account.sync_epoch, highWatermark, cursor: nextCursor, hasMore: nextCursor < highWatermark, minAvailableRevision: account.min_available_revision, serverTime: now, records };
}

export async function exportRemoteData(env: Env, ownerUid: string, input: { cursor: number; untilRevision?: number; limit: number }) {
  const account = await env.DB.prepare("SELECT sync_epoch,revision FROM sync_accounts WHERE firebase_uid=?")
    .bind(ownerUid).first<{ sync_epoch: number; revision: number }>();
  const highWatermark = input.untilRevision ?? account?.revision ?? 0;
  if (highWatermark < input.cursor || highWatermark > (account?.revision ?? 0)) throw new HttpError(400, "Cursor de exportação inválido.");
  const rows = await env.DB.prepare("WITH ranked AS (SELECT revision,entity_type,record_id,version,is_deleted,deleted_at,payload_ciphertext,payload_iv,key_id,ROW_NUMBER() OVER (PARTITION BY entity_type,record_id ORDER BY revision DESC) AS position FROM sync_changes WHERE firebase_uid=? AND revision<=?) SELECT revision,entity_type,record_id,version,is_deleted,deleted_at,payload_ciphertext,payload_iv,key_id FROM ranked WHERE position=1 AND revision>? ORDER BY revision LIMIT ?")
    .bind(ownerUid, highWatermark, input.cursor, input.limit)
    .all<{ revision: number; entity_type: SyncEntityType; record_id: string; version: number; is_deleted: number; deleted_at: string | null; payload_ciphertext: string; payload_iv: string; key_id: string }>();
  const records = [];
  let cursor = input.cursor;
  for (const row of rows.results ?? []) {
    const payload = await decryptPayload<Record<string, unknown>>(env, ownerUid, row.entity_type, row.record_id, { payloadCiphertext: row.payload_ciphertext, payloadIv: row.payload_iv, keyId: row.key_id });
    records.push({ entityType: row.entity_type, recordId: row.record_id, version: row.version, revision: row.revision, isDeleted: row.is_deleted === 1, deletedAt: row.deleted_at ?? undefined, payload });
    cursor = row.revision;
  }
  if ((rows.results?.length ?? 0) < input.limit) cursor = highWatermark;
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), syncEpoch: account?.sync_epoch ?? 1, highWatermark, cursor, hasMore: cursor < highWatermark, records };
}

export async function deleteFinancialData(
  env: Env,
  ownerUid: string,
  requestId: string,
  expectedEpoch: number,
  now = new Date(),
  condition: { nonceHash?: string; retentionDue?: boolean } = {},
) {
  const nextEpoch = expectedEpoch + 1;
  const guardId = crypto.randomUUID();
  const timestamp = now.toISOString();
  const accountCondition = condition.nonceHash
    ? "EXISTS(SELECT 1 FROM sync_accounts WHERE firebase_uid=? AND sync_epoch=?) AND EXISTS(SELECT 1 FROM sync_deletion_nonces WHERE firebase_uid=? AND nonce_hash=? AND used_at IS NULL AND expires_at>?)"
    : condition.retentionDue
      ? "EXISTS(SELECT 1 FROM sync_accounts WHERE firebase_uid=? AND sync_epoch=?) AND EXISTS(SELECT 1 FROM sync_retention WHERE firebase_uid=? AND purge_after IS NOT NULL AND purge_after<=?)"
      : "EXISTS(SELECT 1 FROM sync_accounts WHERE firebase_uid=? AND sync_epoch=?)";
  const conditionValues = condition.nonceHash
    ? [ownerUid, expectedEpoch, ownerUid, condition.nonceHash, timestamp]
    : condition.retentionDue
      ? [ownerUid, expectedEpoch, ownerUid, timestamp]
      : [ownerUid, expectedEpoch];
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT INTO sync_write_guards (firebase_uid,request_id,valid) SELECT ?,?,CASE WHEN ${accountCondition} THEN 1 ELSE 0 END`)
      .bind(ownerUid, guardId, ...conditionValues),
  ];
  for (const table of ["sync_import_chunks", "sync_import_records", "sync_import_sessions", "sync_mutation_receipts", "sync_batches", "sync_changes", "sync_tombstones", "sync_record_aliases", "sync_base_snapshots", "sync_conflicts", "sync_devices", "sync_series_segments", "sync_transactions", "sync_calculator_entries", "sync_series", "sync_categories", "sync_profiles", "sync_retention", "sync_deletion_nonces"])
    statements.push(env.DB.prepare(`DELETE FROM ${table} WHERE firebase_uid=?`).bind(ownerUid));
  statements.push(env.DB.prepare("UPDATE sync_accounts SET sync_epoch=?,revision=0,min_available_revision=0,activated_at=NULL,disabled_at=?,updated_at=? WHERE firebase_uid=? AND sync_epoch=?")
    .bind(nextEpoch, timestamp, timestamp, ownerUid, expectedEpoch));
  statements.push(env.DB.prepare("INSERT INTO sync_deletion_requests (firebase_uid,request_id,requested_at,completed_at,resulting_epoch) VALUES (?,?,?,?,?)")
    .bind(ownerUid, requestId, timestamp, timestamp, nextEpoch));
  statements.push(env.DB.prepare("DELETE FROM sync_write_guards WHERE firebase_uid=? AND request_id=?").bind(ownerUid, guardId));
  await env.DB.batch(statements);
  return nextEpoch;
}

export async function purgeEligibleAccounts(env: Env, now = new Date(), limit = 25) {
  const eligible = await env.DB.prepare("SELECT r.firebase_uid,a.sync_epoch FROM sync_retention r JOIN sync_accounts a ON a.firebase_uid=r.firebase_uid WHERE r.purge_after IS NOT NULL AND r.purge_after<=? ORDER BY r.purge_after LIMIT ?")
    .bind(now.toISOString(), limit).all<{ firebase_uid: string; sync_epoch: number }>();
  let purged = 0;
  for (const item of eligible.results ?? []) {
    const stillEligible = await env.DB.prepare("SELECT 1 AS ok FROM sync_retention WHERE firebase_uid=? AND purge_after IS NOT NULL AND purge_after<=?")
      .bind(item.firebase_uid, now.toISOString()).first<{ ok: number }>();
    if (!stillEligible) continue;
    await deleteFinancialData(env, item.firebase_uid, `retention:${crypto.randomUUID()}`, item.sync_epoch, now, { retentionDue: true });
    purged += 1;
  }
  return purged;
}
