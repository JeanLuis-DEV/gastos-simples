export interface D1Result<T = Record<string, unknown>> { results?: T[]; success: boolean; meta?: { changes?: number } }
export interface D1PreparedStatement { bind(...values: unknown[]): D1PreparedStatement; first<T = Record<string, unknown>>(): Promise<T | null>; run(): Promise<D1Result>; all<T = Record<string, unknown>>(): Promise<D1Result<T>> }
export interface D1Database { prepare(query: string): D1PreparedStatement; batch(statements: D1PreparedStatement[]): Promise<D1Result[]> }

export type MaintenanceConfig = {
  accountLimit: number;
  tombstoneRetentionDays: number;
  technicalRetentionDays: number;
  compactionEnabled: boolean;
};

export type MaintenanceMetrics = {
  requestId: string;
  durationMs: number;
  purgedAccounts: number;
  compactedAccounts: number;
  expiredImports: number;
  expiredNonces: number;
  deletedReceipts: number;
  deletedBatches: number;
  failures: number;
  code: "ok" | "partial_failure" | "failed";
};

const DAY_MS = 24 * 60 * 60 * 1000;
const financialTables = ["sync_import_chunks", "sync_import_records", "sync_import_sessions", "sync_mutation_receipts", "sync_batches", "sync_changes", "sync_tombstones", "sync_record_aliases", "sync_base_snapshots", "sync_conflicts", "sync_devices", "sync_series_segments", "sync_transactions", "sync_calculator_entries", "sync_series", "sync_categories", "sync_profiles", "sync_retention", "sync_deletion_nonces"];

async function purgeAccount(db: D1Database, ownerUid: string, epoch: number, revision: number, now: string, requestId: string) {
  const guardId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO sync_write_guards (firebase_uid,request_id,valid) SELECT ?,?,CASE WHEN EXISTS(SELECT 1 FROM sync_accounts a JOIN sync_retention r ON r.firebase_uid=a.firebase_uid WHERE a.firebase_uid=? AND a.sync_epoch=? AND a.revision=? AND r.purge_after IS NOT NULL AND r.purge_after<=?) THEN 1 ELSE 0 END").bind(ownerUid, guardId, ownerUid, epoch, revision, now),
  ];
  financialTables.forEach((table) => statements.push(db.prepare(`DELETE FROM ${table} WHERE firebase_uid=?`).bind(ownerUid)));
  statements.push(
    db.prepare("UPDATE sync_accounts SET sync_epoch=?,revision=0,min_available_revision=0,activated_at=NULL,disabled_at=?,updated_at=? WHERE firebase_uid=? AND sync_epoch=? AND revision=?").bind(epoch + 1, now, now, ownerUid, epoch, revision),
    db.prepare("INSERT INTO sync_deletion_requests (firebase_uid,request_id,requested_at,completed_at,resulting_epoch) VALUES (?,?,?,?,?) ON CONFLICT(firebase_uid,request_id) DO NOTHING").bind(ownerUid, `retention:${requestId}`, now, now, epoch + 1),
    db.prepare("DELETE FROM sync_write_guards WHERE firebase_uid=? AND request_id=?").bind(ownerUid, guardId),
  );
  await db.batch(statements);
}

async function compactAccount(db: D1Database, ownerUid: string, revision: number, currentMinimum: number, cutoff: string) {
  const boundary = await db.prepare("SELECT MAX(revision) boundary FROM sync_changes WHERE firebase_uid=? AND changed_at<=?").bind(ownerUid, cutoff).first<{ boundary: number | null }>();
  const cutoffRevision = boundary?.boundary ?? 0;
  if (!cutoffRevision || cutoffRevision <= currentMinimum) return false;
  const guardId = crypto.randomUUID();
  const oldTombstone = "t.firebase_uid=? AND t.deleted_at<=?";
  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO sync_write_guards (firebase_uid,request_id,valid) SELECT ?,?,CASE WHEN EXISTS(SELECT 1 FROM sync_accounts WHERE firebase_uid=? AND revision=?) THEN 1 ELSE 0 END").bind(ownerUid, guardId, ownerUid, revision),
    db.prepare(`DELETE FROM sync_base_snapshots WHERE firebase_uid=? AND EXISTS(SELECT 1 FROM sync_tombstones t WHERE ${oldTombstone} AND t.entity_type=sync_base_snapshots.entity_type AND t.record_id=sync_base_snapshots.record_id)`).bind(ownerUid, ownerUid, cutoff),
    db.prepare(`DELETE FROM sync_changes WHERE firebase_uid=? AND (EXISTS(SELECT 1 FROM sync_tombstones t WHERE ${oldTombstone} AND t.entity_type=sync_changes.entity_type AND t.record_id=sync_changes.record_id) OR (revision<=? AND revision<(SELECT MAX(newer.revision) FROM sync_changes newer WHERE newer.firebase_uid=sync_changes.firebase_uid AND newer.entity_type=sync_changes.entity_type AND newer.record_id=sync_changes.record_id)))`).bind(ownerUid, ownerUid, cutoff, cutoffRevision),
    db.prepare("DELETE FROM sync_transactions WHERE firebase_uid=? AND is_deleted=1 AND deleted_at<=?").bind(ownerUid, cutoff),
    db.prepare("DELETE FROM sync_series_segments WHERE firebase_uid=? AND is_deleted=1 AND deleted_at<=?").bind(ownerUid, cutoff),
    db.prepare("DELETE FROM sync_calculator_entries WHERE firebase_uid=? AND is_deleted=1 AND deleted_at<=?").bind(ownerUid, cutoff),
    db.prepare("DELETE FROM sync_series WHERE firebase_uid=? AND is_deleted=1 AND deleted_at<=?").bind(ownerUid, cutoff),
    db.prepare("DELETE FROM sync_categories WHERE firebase_uid=? AND is_deleted=1 AND deleted_at<=?").bind(ownerUid, cutoff),
    db.prepare("DELETE FROM sync_profiles WHERE firebase_uid=? AND is_deleted=1 AND deleted_at<=?").bind(ownerUid, cutoff),
    db.prepare("DELETE FROM sync_tombstones WHERE firebase_uid=? AND deleted_at<=?").bind(ownerUid, cutoff),
    db.prepare("UPDATE sync_accounts SET min_available_revision=MAX(min_available_revision,?),updated_at=? WHERE firebase_uid=? AND revision=?").bind(cutoffRevision, new Date().toISOString(), ownerUid, revision),
    db.prepare("DELETE FROM sync_write_guards WHERE firebase_uid=? AND request_id=?").bind(ownerUid, guardId),
  ];
  await db.batch(statements);
  return true;
}

export async function runMaintenance(db: D1Database, now: Date, requestId: string, config: MaintenanceConfig): Promise<MaintenanceMetrics> {
  const started = Date.now();
  const existing = await db.prepare("SELECT status,metrics_json FROM sync_maintenance_runs WHERE request_id=?").bind(requestId).first<{ status: string; metrics_json: string | null }>();
  if (existing?.metrics_json) return JSON.parse(existing.metrics_json) as MaintenanceMetrics;
  if (existing) throw new Error("maintenance_already_running");
  const timestamp = now.toISOString();
  await db.prepare("INSERT INTO sync_maintenance_runs (request_id,started_at,status) VALUES (?,?,'running')").bind(requestId, timestamp).run();
  const metrics: MaintenanceMetrics = { requestId, durationMs: 0, purgedAccounts: 0, compactedAccounts: 0, expiredImports: 0, expiredNonces: 0, deletedReceipts: 0, deletedBatches: 0, failures: 0, code: "ok" };
  try {
    const technicalCutoff = new Date(now.getTime() - config.technicalRetentionDays * DAY_MS).toISOString();
    const cleanup = await db.batch([
      db.prepare("DELETE FROM sync_import_sessions WHERE status IN ('open','aborted') AND expires_at<=?").bind(timestamp),
      db.prepare("DELETE FROM sync_deletion_nonces WHERE expires_at<=?").bind(timestamp),
      db.prepare("DELETE FROM sync_mutation_receipts WHERE created_at<=?").bind(technicalCutoff),
      db.prepare("DELETE FROM sync_batches WHERE created_at<=? AND NOT EXISTS(SELECT 1 FROM sync_mutation_receipts r WHERE r.firebase_uid=sync_batches.firebase_uid AND r.batch_id=sync_batches.batch_id)").bind(technicalCutoff),
      db.prepare("DELETE FROM sync_conflicts WHERE resolved_at IS NOT NULL AND resolved_at<=?").bind(technicalCutoff),
      db.prepare("DELETE FROM sync_devices WHERE last_seen_at<=?").bind(technicalCutoff),
    ]);
    metrics.expiredImports = cleanup[0]?.meta?.changes ?? 0;
    metrics.expiredNonces = cleanup[1]?.meta?.changes ?? 0;
    metrics.deletedReceipts = cleanup[2]?.meta?.changes ?? 0;
    metrics.deletedBatches = cleanup[3]?.meta?.changes ?? 0;

    const due = await db.prepare("SELECT a.firebase_uid,a.sync_epoch,a.revision FROM sync_retention r JOIN sync_accounts a ON a.firebase_uid=r.firebase_uid WHERE r.purge_after IS NOT NULL AND r.purge_after<=? ORDER BY r.purge_after LIMIT ?").bind(timestamp, config.accountLimit).all<{ firebase_uid: string; sync_epoch: number; revision: number }>();
    for (const account of due.results ?? []) {
      try { await purgeAccount(db, account.firebase_uid, account.sync_epoch, account.revision, timestamp, requestId); metrics.purgedAccounts += 1; }
      catch { metrics.failures += 1; }
    }

    if (config.compactionEnabled) {
      const cutoff = new Date(now.getTime() - config.tombstoneRetentionDays * DAY_MS).toISOString();
      const candidates = await db.prepare("SELECT DISTINCT a.firebase_uid,a.revision,a.min_available_revision FROM sync_accounts a JOIN sync_tombstones t ON t.firebase_uid=a.firebase_uid WHERE t.deleted_at<=? ORDER BY a.firebase_uid LIMIT ?").bind(cutoff, config.accountLimit).all<{ firebase_uid: string; revision: number; min_available_revision: number }>();
      for (const account of candidates.results ?? []) {
        try { if (await compactAccount(db, account.firebase_uid, account.revision, account.min_available_revision, cutoff)) metrics.compactedAccounts += 1; }
        catch { metrics.failures += 1; }
      }
    }
    metrics.code = metrics.failures ? "partial_failure" : "ok";
  } catch {
    metrics.failures += 1;
    metrics.code = "failed";
  }
  metrics.durationMs = Date.now() - started;
  await db.prepare("UPDATE sync_maintenance_runs SET completed_at=?,status=?,metrics_json=?,error_code=? WHERE request_id=?").bind(new Date().toISOString(), metrics.code === "ok" ? "completed" : metrics.code, JSON.stringify(metrics), metrics.code === "ok" ? null : metrics.code, requestId).run();
  return metrics;
}
