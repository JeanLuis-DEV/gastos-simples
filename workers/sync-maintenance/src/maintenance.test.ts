// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";
import { runMaintenance, type D1Database, type MaintenanceConfig } from "./maintenance";

const migrations = [1, 2, 3, 4].map((number) => readFileSync(resolve(`migrations/${String(number).padStart(4, "0")}_${["initial", "sync", "sync_imports", "sync_maintenance"][number - 1]}.sql`), "utf8"));
const instances: Miniflare[] = [];
const config: MaintenanceConfig = { accountLimit: 25, tombstoneRetentionDays: 180, technicalRetentionDays: 180, compactionEnabled: true };

async function database() {
  const instance = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: "2026-09-09", modules: true, script: "export default { fetch() { return new Response('ok') } }", d1Databases: { DB: crypto.randomUUID() } }));
  instances.push(instance);
  const db = await instance.getD1Database("DB") as unknown as D1Database;
  for (const migration of migrations) {
    const statements = migration.split(";").map((statement) => statement.trim()).filter(Boolean);
    await db.batch(statements.map((statement) => db.prepare(statement)));
  }
  return db;
}

async function seedAccount(db: D1Database, uid: string, purgeAfter: string | null, revision = 0) {
  await db.batch([
    db.prepare("INSERT INTO users (firebase_uid,email,created_at,updated_at) VALUES (?,?,?,?)").bind(uid, `${uid}@example.test`, "2027-01-01", "2027-01-01"),
    db.prepare("INSERT INTO subscriptions (firebase_uid,status_normalized,status_original,created_at,updated_at,last_verified_at) VALUES (?,?,?,?,?,?)").bind(uid, "cancelled", "cancelled", "2027-01-01", "2027-01-01", "2027-01-01"),
    db.prepare("INSERT INTO sync_accounts (firebase_uid,sync_epoch,revision,activated_at,created_at,updated_at) VALUES (?,1,?,?,?,?)").bind(uid, revision, "2027-01-01", "2027-01-01", "2027-01-01"),
    db.prepare("INSERT INTO sync_retention (firebase_uid,entitlement_status,became_ineligible_at,purge_after,updated_at) VALUES (?,?,?,?,?)").bind(uid, "cancelled", "2027-01-01", purgeAfter, "2027-01-01"),
    db.prepare("INSERT INTO sync_profiles (firebase_uid,record_id,version,revision,is_deleted,payload_ciphertext,payload_iv,key_id,created_at,updated_at) VALUES (?,?,1,1,0,'cipher','iv','key','2027-01-01','2027-01-01')").bind(uid, `profile-${uid}`),
  ]);
}

afterEach(async () => Promise.all(instances.splice(0).map((instance) => instance.dispose())));

describe("Worker local de retenção", { timeout: 20_000 }, () => {
  it("expira dados financeiros sem remover conta, assinatura ou webhook e repete com segurança", async () => {
    const db = await database();
    await seedAccount(db, "uid-due", "2027-06-01T00:00:00.000Z", 1);
    await seedAccount(db, "uid-safe", null, 1);
    await db.batch([
      db.prepare("INSERT INTO webhook_events (event_id,type,resource_id,processed_at,result) VALUES ('event-1','subscription','resource','2027-01-01','ok')"),
      db.prepare("INSERT INTO sync_import_sessions (firebase_uid,session_id,mode,base_revision,status,next_chunk,record_count,created_at,expires_at) VALUES ('uid-safe','expired-import','replace',1,'open',0,0,'2027-01-01','2027-01-02')"),
      db.prepare("INSERT INTO sync_deletion_nonces (firebase_uid,nonce_hash,issued_at,expires_at,auth_time) VALUES ('uid-safe','expired-nonce','2027-01-01','2027-01-02',1)"),
    ]);
    const first = await runMaintenance(db, new Date("2028-01-01T00:00:00.000Z"), "run-idempotent", config);
    expect(first).toMatchObject({ purgedAccounts: 1, expiredImports: 1, expiredNonces: 1, failures: 0, code: "ok" });
    await expect(runMaintenance(db, new Date("2028-01-01T00:00:00.000Z"), "run-idempotent", config)).resolves.toEqual(first);
    expect(await db.prepare("SELECT sync_epoch,revision FROM sync_accounts WHERE firebase_uid='uid-due'").first()).toEqual({ sync_epoch: 2, revision: 0 });
    expect(await db.prepare("SELECT COUNT(*) count FROM sync_profiles WHERE firebase_uid='uid-due'").first()).toEqual({ count: 0 });
    expect(await db.prepare("SELECT COUNT(*) count FROM users WHERE firebase_uid='uid-due'").first()).toEqual({ count: 1 });
    expect(await db.prepare("SELECT COUNT(*) count FROM subscriptions WHERE firebase_uid='uid-due'").first()).toEqual({ count: 1 });
    expect(await db.prepare("SELECT COUNT(*) count FROM webhook_events").first()).toEqual({ count: 1 });
    expect(await db.prepare("SELECT COUNT(*) count FROM sync_profiles WHERE firebase_uid='uid-safe'").first()).toEqual({ count: 1 });
  });

  it("preserva conta reativada antes da execução", async () => {
    const db = await database();
    await seedAccount(db, "uid-reactivated", null, 1);
    const result = await runMaintenance(db, new Date("2028-01-01T00:00:00.000Z"), "run-reactivated", config);
    expect(result.purgedAccounts).toBe(0);
    expect(await db.prepare("SELECT COUNT(*) count FROM sync_profiles WHERE firebase_uid='uid-reactivated'").first()).toEqual({ count: 1 });
  });

  it("compacta tombstones antigos, mantém o snapshot ativo e avança minAvailableRevision", async () => {
    const db = await database();
    await seedAccount(db, "uid-compact", null, 3);
    await db.batch([
      db.prepare("INSERT INTO sync_calculator_entries (firebase_uid,record_id,version,revision,is_deleted,deleted_at,payload_ciphertext,payload_iv,key_id,created_at,updated_at) VALUES ('uid-compact','calc-old',2,3,1,'2027-01-03','cipher','iv','key','2027-01-01','2027-01-03')"),
      db.prepare("INSERT INTO sync_changes (firebase_uid,revision,entity_type,record_id,version,is_deleted,deleted_at,payload_ciphertext,payload_iv,key_id,changed_at) VALUES ('uid-compact',1,'profile','profile-uid-compact',1,0,NULL,'cipher','iv','key','2027-01-01'),('uid-compact',2,'calculator','calc-old',1,0,NULL,'cipher','iv','key','2027-01-02'),('uid-compact',3,'calculator','calc-old',2,1,'2027-01-03','cipher','iv','key','2027-01-03')"),
      db.prepare("INSERT INTO sync_tombstones (firebase_uid,entity_type,record_id,version,revision,deleted_at) VALUES ('uid-compact','calculator','calc-old',2,3,'2027-01-03')"),
    ]);
    const result = await runMaintenance(db, new Date("2028-01-01T00:00:00.000Z"), "run-compact", config);
    expect(result).toMatchObject({ compactedAccounts: 1, failures: 0 });
    expect(await db.prepare("SELECT min_available_revision FROM sync_accounts WHERE firebase_uid='uid-compact'").first()).toEqual({ min_available_revision: 3 });
    expect(await db.prepare("SELECT revision FROM sync_changes WHERE firebase_uid='uid-compact' ORDER BY revision").all()).toMatchObject({ results: [{ revision: 1 }] });
    expect(await db.prepare("SELECT COUNT(*) count FROM sync_tombstones WHERE firebase_uid='uid-compact'").first()).toEqual({ count: 0 });
  });

  it("isola falha de uma conta e conclui as demais sem exclusão parcial", async () => {
    const db = await database();
    await seedAccount(db, "uid-fail", "2027-05-01T00:00:00.000Z", 1);
    await seedAccount(db, "uid-ok", "2027-06-01T00:00:00.000Z", 1);
    await db.prepare("CREATE TRIGGER block_test_delete BEFORE DELETE ON sync_profiles WHEN OLD.firebase_uid='uid-fail' BEGIN SELECT RAISE(ABORT,'forced test failure'); END").run();
    const result = await runMaintenance(db, new Date("2028-01-01T00:00:00.000Z"), "run-partial", config);
    expect(result).toMatchObject({ purgedAccounts: 1, failures: 1, code: "partial_failure" });
    expect(await db.prepare("SELECT COUNT(*) count FROM sync_profiles WHERE firebase_uid='uid-fail'").first()).toEqual({ count: 1 });
    expect(await db.prepare("SELECT COUNT(*) count FROM sync_profiles WHERE firebase_uid='uid-ok'").first()).toEqual({ count: 0 });
  });
});
