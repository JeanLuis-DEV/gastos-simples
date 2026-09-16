import type { D1PreparedStatement, Env } from "../types";
import { HttpError } from "./http";
import { canonicalJson, contentHash, encryptPayload } from "./syncCrypto";
import { structuralFields } from "./syncRecords";
import type { SyncEntityType } from "./syncValidation";
import { validateEntityPayload } from "./syncValidation";

type ImportRecord = { entityType: SyncEntityType; recordId: string; payload: Record<string, unknown> };
const entityOrder: SyncEntityType[] = ["profile", "category", "series", "seriesSegment", "transaction", "calculator"];
const normalize = (value: unknown) => String(value).trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export async function startImport(env: Env, ownerUid: string, mode: "merge" | "replace", baseRevision: number) {
  const account = await env.DB.prepare("SELECT revision,activated_at,disabled_at FROM sync_accounts WHERE firebase_uid=?").bind(ownerUid).first<{ revision: number; activated_at: string | null; disabled_at: string | null }>();
  if (!account?.activated_at || account.disabled_at) throw new HttpError(409, "Ative a sincronização antes de importar.");
  if (account.revision !== baseRevision) throw new HttpError(409, "Os dados remotos mudaram. Sincronize antes de importar.");
  const now = new Date();
  await env.DB.prepare("DELETE FROM sync_import_sessions WHERE firebase_uid=? AND status IN ('open','aborted') AND expires_at<=?").bind(ownerUid, now.toISOString()).run();
  const existing = await env.DB.prepare("SELECT session_id,mode,base_revision,next_chunk,expires_at FROM sync_import_sessions WHERE firebase_uid=? AND status='open' ORDER BY created_at DESC LIMIT 1")
    .bind(ownerUid).first<{ session_id: string; mode: string; base_revision: number; next_chunk: number; expires_at: string }>();
  if (existing) {
    if (existing.mode === mode && existing.base_revision === baseRevision && existing.next_chunk === 0)
      return { sessionId: existing.session_id, nextChunk: 0, expiresAt: existing.expires_at };
    throw new HttpError(409, "Já existe uma importação em andamento.");
  }
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sync_import_sessions (firebase_uid,session_id,mode,base_revision,status,next_chunk,record_count,created_at,expires_at) VALUES (?,?,?,?, 'open',0,0,?,?)")
    .bind(ownerUid, sessionId, mode, baseRevision, now.toISOString(), expiresAt).run();
  return { sessionId, nextChunk: 0, expiresAt };
}

export async function appendImportChunk(env: Env, ownerUid: string, sessionId: string, chunkIndex: number, records: ImportRecord[]) {
  const hash = await contentHash({ sessionId, chunkIndex, records });
  const prior = await env.DB.prepare("SELECT content_hash,response_json FROM sync_import_chunks WHERE firebase_uid=? AND session_id=? AND chunk_index=?")
    .bind(ownerUid, sessionId, chunkIndex).first<{ content_hash: string; response_json: string }>();
  if (prior) {
    if (prior.content_hash !== hash) throw new HttpError(409, "O bloco já foi usado com outro conteúdo.");
    return JSON.parse(prior.response_json) as Record<string, unknown>;
  }
  const session = await env.DB.prepare("SELECT status,next_chunk,record_count,expires_at FROM sync_import_sessions WHERE firebase_uid=? AND session_id=?")
    .bind(ownerUid, sessionId).first<{ status: string; next_chunk: number; record_count: number; expires_at: string }>();
  if (!session || session.status !== "open" || session.next_chunk !== chunkIndex || Date.parse(session.expires_at) <= Date.now()) throw new HttpError(409, "Sessão de importação inválida ou expirada.");
  if (session.record_count + records.length > 111_600) throw new HttpError(413, "A importação excede o limite permitido.");
  const unique = new Set<string>();
  const now = new Date().toISOString();
  const encrypted = await Promise.all(records.map(async (record) => {
    validateEntityPayload(record.entityType, record.payload);
    const identity = `${record.entityType}:${record.recordId}`;
    if (unique.has(identity)) throw new HttpError(400, "O bloco contém registros duplicados.");
    unique.add(identity);
    const fields = structuralFields(record.entityType, record.payload);
    const structural = Object.fromEntries(fields.columns.map((column, index) => [column, fields.values[index]]));
    if (record.entityType === "transaction" || record.entityType === "seriesSegment") structural.category_key = `${record.payload.type}:${normalize(record.payload.categoryName)}`;
    const payload = await encryptPayload(env, ownerUid, record.entityType, record.recordId, record.payload);
    return { entity_type: record.entityType, record_id: record.recordId, structural_json: JSON.stringify(structural), payload_ciphertext: payload.payloadCiphertext, payload_iv: payload.payloadIv, key_id: payload.keyId, created_at: now };
  }));
  const response = { sessionId, acceptedChunk: chunkIndex, nextChunk: chunkIndex + 1, acceptedRecords: records.length };
  const guardId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO sync_write_guards (firebase_uid,request_id,valid) SELECT ?,?,CASE WHEN EXISTS(SELECT 1 FROM sync_import_sessions WHERE firebase_uid=? AND session_id=? AND status='open' AND next_chunk=? AND expires_at>?) THEN 1 ELSE 0 END").bind(ownerUid, guardId, ownerUid, sessionId, chunkIndex, now),
  ];
  if (encrypted.length) statements.push(env.DB.prepare("INSERT INTO sync_import_records (firebase_uid,session_id,entity_type,record_id,structural_json,payload_ciphertext,payload_iv,key_id,created_at) SELECT ?,?,json_extract(value,'$.entity_type'),json_extract(value,'$.record_id'),json_extract(value,'$.structural_json'),json_extract(value,'$.payload_ciphertext'),json_extract(value,'$.payload_iv'),json_extract(value,'$.key_id'),json_extract(value,'$.created_at') FROM json_each(?)")
    .bind(ownerUid, sessionId, JSON.stringify(encrypted)));
  statements.push(
    env.DB.prepare("INSERT INTO sync_import_chunks (firebase_uid,session_id,chunk_index,content_hash,response_json,created_at) VALUES (?,?,?,?,?,?)").bind(ownerUid, sessionId, chunkIndex, hash, canonicalJson(response), now),
    env.DB.prepare("UPDATE sync_import_sessions SET next_chunk=next_chunk+1,record_count=record_count+? WHERE firebase_uid=? AND session_id=?").bind(records.length, ownerUid, sessionId),
    env.DB.prepare("DELETE FROM sync_write_guards WHERE firebase_uid=? AND request_id=?").bind(ownerUid, guardId),
  );
  try { await env.DB.batch(statements); }
  catch { throw new HttpError(409, "Não foi possível armazenar este bloco. Tente novamente."); }
  return response;
}

async function validateStagedImport(env: Env, ownerUid: string, sessionId: string) {
  const invalid = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM sync_import_records WHERE firebase_uid=? AND session_id=? AND entity_type='profile') AS profiles,
    (SELECT COUNT(*) FROM sync_import_records WHERE firebase_uid=? AND session_id=? AND entity_type='calculator') AS calculators,
    (SELECT COUNT(*) FROM (SELECT json_extract(structural_json,'$.canonical_key') value,COUNT(*) count FROM sync_import_records WHERE firebase_uid=? AND session_id=? AND entity_type='category' GROUP BY value HAVING count>1)) AS duplicate_categories,
    (SELECT COUNT(*) FROM (SELECT json_extract(structural_json,'$.occurrence_key') value,COUNT(*) count FROM sync_import_records WHERE firebase_uid=? AND session_id=? AND entity_type='transaction' GROUP BY value HAVING count>1)) AS duplicate_occurrences,
    (SELECT COUNT(*) FROM (SELECT json_extract(structural_json,'$.series_id') series_id,json_extract(structural_json,'$.effective_from') effective_from,COUNT(*) count FROM sync_import_records WHERE firebase_uid=? AND session_id=? AND entity_type='seriesSegment' GROUP BY series_id,effective_from HAVING count>1)) AS duplicate_segments,
    (SELECT COUNT(*) FROM sync_import_records r LEFT JOIN sync_import_records p ON p.firebase_uid=r.firebase_uid AND p.session_id=r.session_id AND p.entity_type='profile' AND p.record_id=json_extract(r.structural_json,'$.profile_id') LEFT JOIN sync_import_records c ON c.firebase_uid=r.firebase_uid AND c.session_id=r.session_id AND c.entity_type='category' AND c.record_id=json_extract(r.structural_json,'$.category_id') LEFT JOIN sync_import_records s ON s.firebase_uid=r.firebase_uid AND s.session_id=r.session_id AND s.entity_type='series' AND s.record_id=json_extract(r.structural_json,'$.series_id') WHERE r.firebase_uid=? AND r.session_id=? AND r.entity_type IN ('transaction','seriesSegment') AND (p.record_id IS NULL OR c.record_id IS NULL OR json_extract(c.structural_json,'$.canonical_key')<>json_extract(r.structural_json,'$.category_key') OR (r.entity_type='seriesSegment' AND s.record_id IS NULL) OR (r.entity_type='transaction' AND json_extract(r.structural_json,'$.series_id') IS NOT NULL AND (s.record_id IS NULL OR json_extract(s.structural_json,'$.kind')<>json_extract(r.structural_json,'$.kind'))))) AS invalid_references`)
    .bind(ownerUid, sessionId, ownerUid, sessionId, ownerUid, sessionId, ownerUid, sessionId, ownerUid, sessionId, ownerUid, sessionId)
    .first<{ profiles: number; calculators: number; duplicate_categories: number; duplicate_occurrences: number; duplicate_segments: number; invalid_references: number }>();
  if (!invalid || invalid.profiles < 1 || invalid.calculators > 100 || invalid.duplicate_categories || invalid.duplicate_occurrences || invalid.duplicate_segments || invalid.invalid_references) throw new HttpError(400, "A importação contém referências ou duplicidades inválidas.");
}

const clearCanonicalTables = ["sync_mutation_receipts", "sync_batches", "sync_changes", "sync_tombstones", "sync_record_aliases", "sync_base_snapshots", "sync_conflicts", "sync_devices", "sync_series_segments", "sync_transactions", "sync_calculator_entries", "sync_series", "sync_categories", "sync_profiles"];

function importEntityStatement(env: Env, ownerUid: string, sessionId: string, entityType: SyncEntityType, offset: number, now: string) {
  const common = "1 AS version,(? + ROW_NUMBER() OVER (ORDER BY record_id)) AS revision,0 AS is_deleted,NULL AS deleted_at,payload_ciphertext,payload_iv,key_id,? AS created_at,? AS updated_at";
  const definitions: Record<SyncEntityType, { table: string; columns: string; values: string }> = {
    profile: { table: "sync_profiles", columns: "record_id", values: "record_id" },
    category: { table: "sync_categories", columns: "record_id,canonical_key,transaction_type", values: "record_id,json_extract(structural_json,'$.canonical_key'),json_extract(structural_json,'$.transaction_type')" },
    series: { table: "sync_series", columns: "record_id,kind,start_date,end_before,installment_total", values: "record_id,json_extract(structural_json,'$.kind'),json_extract(structural_json,'$.start_date'),json_extract(structural_json,'$.end_before'),json_extract(structural_json,'$.installment_total')" },
    seriesSegment: { table: "sync_series_segments", columns: "record_id,series_id,effective_from,anchor_due_date,profile_id,category_id,transaction_type", values: "record_id,json_extract(structural_json,'$.series_id'),json_extract(structural_json,'$.effective_from'),json_extract(structural_json,'$.anchor_due_date'),json_extract(structural_json,'$.profile_id'),json_extract(structural_json,'$.category_id'),json_extract(structural_json,'$.transaction_type')" },
    transaction: { table: "sync_transactions", columns: "record_id,profile_id,category_id,series_id,occurrence_key,due_date,kind,transaction_type", values: "record_id,json_extract(structural_json,'$.profile_id'),json_extract(structural_json,'$.category_id'),json_extract(structural_json,'$.series_id'),json_extract(structural_json,'$.occurrence_key'),json_extract(structural_json,'$.due_date'),json_extract(structural_json,'$.kind'),json_extract(structural_json,'$.transaction_type')" },
    calculator: { table: "sync_calculator_entries", columns: "record_id", values: "record_id" },
  };
  const item = definitions[entityType];
  return env.DB.prepare(`INSERT INTO ${item.table} (firebase_uid,${item.columns},version,revision,is_deleted,deleted_at,payload_ciphertext,payload_iv,key_id,created_at,updated_at) SELECT ?,${item.values},${common} FROM sync_import_records WHERE firebase_uid=? AND session_id=? AND entity_type=? ORDER BY record_id`)
    .bind(ownerUid, offset, now, now, ownerUid, sessionId, entityType);
}

export async function commitImport(env: Env, ownerUid: string, sessionId: string) {
  const session = await env.DB.prepare("SELECT status,base_revision,record_count,result_json,expires_at FROM sync_import_sessions WHERE firebase_uid=? AND session_id=?")
    .bind(ownerUid, sessionId).first<{ status: string; base_revision: number; record_count: number; result_json: string | null; expires_at: string }>();
  if (!session) throw new HttpError(404, "Sessão de importação inexistente.");
  if (session.status === "committed" && session.result_json) return JSON.parse(session.result_json) as Record<string, unknown>;
  if (session.status !== "open" || Date.parse(session.expires_at) <= Date.now()) throw new HttpError(409, "Sessão de importação inválida ou expirada.");
  await validateStagedImport(env, ownerUid, sessionId);
  const counts = await env.DB.prepare("SELECT entity_type,COUNT(*) count FROM sync_import_records WHERE firebase_uid=? AND session_id=? GROUP BY entity_type")
    .bind(ownerUid, sessionId).all<{ entity_type: SyncEntityType; count: number }>();
  const byEntity = new Map((counts.results ?? []).map((item) => [item.entity_type, item.count]));
  const maxima: Record<SyncEntityType, number> = { profile: 500, category: 1_000, series: 10_000, seriesSegment: 50_000, transaction: 50_000, calculator: 100 };
  if (entityOrder.some((entityType) => (byEntity.get(entityType) ?? 0) > maxima[entityType])) throw new HttpError(413, "A importação excede os limites permitidos.");
  const now = new Date().toISOString();
  const account = await env.DB.prepare("SELECT sync_epoch FROM sync_accounts WHERE firebase_uid=?").bind(ownerUid).first<{ sync_epoch: number }>();
  const nextEpoch = (account?.sync_epoch ?? 1) + 1;
  const response = { committed: true, syncEpoch: nextEpoch, highWatermark: session.record_count, importedRecords: session.record_count };
  const guardId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [env.DB.prepare("INSERT INTO sync_write_guards (firebase_uid,request_id,valid) SELECT ?,?,CASE WHEN EXISTS(SELECT 1 FROM sync_accounts WHERE firebase_uid=? AND revision=? AND activated_at IS NOT NULL AND disabled_at IS NULL) AND EXISTS(SELECT 1 FROM sync_import_sessions WHERE firebase_uid=? AND session_id=? AND status='open' AND expires_at>?) THEN 1 ELSE 0 END")
    .bind(ownerUid, guardId, ownerUid, session.base_revision, ownerUid, sessionId, now)];
  clearCanonicalTables.forEach((table) => statements.push(env.DB.prepare(`DELETE FROM ${table} WHERE firebase_uid=?`).bind(ownerUid)));
  let offset = 0;
  for (const entityType of entityOrder) {
    statements.push(importEntityStatement(env, ownerUid, sessionId, entityType, offset, now));
    offset += byEntity.get(entityType) ?? 0;
  }
  statements.push(env.DB.prepare("INSERT INTO sync_changes (firebase_uid,revision,entity_type,record_id,version,is_deleted,deleted_at,payload_ciphertext,payload_iv,key_id,changed_at) SELECT ?,ROW_NUMBER() OVER (ORDER BY CASE entity_type WHEN 'profile' THEN 1 WHEN 'category' THEN 2 WHEN 'series' THEN 3 WHEN 'seriesSegment' THEN 4 WHEN 'transaction' THEN 5 ELSE 6 END,record_id),entity_type,record_id,1,0,NULL,payload_ciphertext,payload_iv,key_id,? FROM sync_import_records WHERE firebase_uid=? AND session_id=?").bind(ownerUid, now, ownerUid, sessionId));
  statements.push(env.DB.prepare("INSERT INTO sync_base_snapshots (firebase_uid,entity_type,record_id,server_version,payload_ciphertext,payload_iv,key_id,created_at) SELECT ?,entity_type,record_id,1,payload_ciphertext,payload_iv,key_id,? FROM sync_import_records WHERE firebase_uid=? AND session_id=?").bind(ownerUid, now, ownerUid, sessionId));
  statements.push(env.DB.prepare("UPDATE sync_accounts SET sync_epoch=?,revision=?,min_available_revision=0,updated_at=? WHERE firebase_uid=? AND revision=?").bind(nextEpoch, session.record_count, now, ownerUid, session.base_revision));
  statements.push(env.DB.prepare("DELETE FROM sync_import_chunks WHERE firebase_uid=? AND session_id=?").bind(ownerUid, sessionId));
  statements.push(env.DB.prepare("DELETE FROM sync_import_records WHERE firebase_uid=? AND session_id=?").bind(ownerUid, sessionId));
  statements.push(env.DB.prepare("UPDATE sync_import_sessions SET status='committed',result_json=?,completed_at=? WHERE firebase_uid=? AND session_id=?").bind(canonicalJson(response), now, ownerUid, sessionId));
  statements.push(env.DB.prepare("DELETE FROM sync_write_guards WHERE firebase_uid=? AND request_id=?").bind(ownerUid, guardId));
  try { await env.DB.batch(statements); }
  catch { throw new HttpError(409, "Os dados mudaram durante a importação. Tente novamente."); }
  return response;
}

export async function abortImport(env: Env, ownerUid: string, sessionId: string) {
  await env.DB.prepare("DELETE FROM sync_import_sessions WHERE firebase_uid=? AND session_id=? AND status='open'").bind(ownerUid, sessionId).run();
  return { aborted: true };
}

export async function cleanupExpiredImports(env: Env, now = new Date()) {
  const result = await env.DB.prepare("DELETE FROM sync_import_sessions WHERE status IN ('open','aborted') AND expires_at<=?").bind(now.toISOString()).run();
  return result.meta?.changes ?? 0;
}
