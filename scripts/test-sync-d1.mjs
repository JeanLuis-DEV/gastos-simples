import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = join(project, "node_modules", "wrangler", "bin", "wrangler.js");
const migration1 = join(project, "migrations", "0001_initial.sql");
const migration2 = join(project, "migrations", "0002_sync.sql");
const migration3 = join(project, "migrations", "0003_sync_imports.sql");

function execute(persistTo, option, value) {
  const output = execFileSync(process.execPath, [
    wrangler, "d1", "execute", "gastos-simples", "--local", "--yes", "--json",
    `--persist-to=${persistTo}`, option, value,
  ], { cwd: project, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output);
}

const sqlFile = (persistTo, file) => execute(persistTo, "--file", file);
const query = (persistTo, sql) => execute(persistTo, "--command", sql)[0]?.results ?? [];
const scalar = (persistTo, sql, field) => query(persistTo, sql)[0]?.[field];

const root = await mkdtemp(join(tmpdir(), "gastos-sync-d1-"));
const fresh = join(root, "fresh");
const upgraded = join(root, "upgraded");
try {
  sqlFile(fresh, migration1);
  sqlFile(fresh, migration2);
  sqlFile(fresh, migration3);
  assert.equal(scalar(fresh, "SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name LIKE 'sync_%'", "count"), 23);
  assert.equal(scalar(fresh, "SELECT COUNT(*) count FROM sqlite_master WHERE type='index' AND name LIKE 'sync_%_idx'", "count"), 19);
  assert.equal(scalar(fresh, "PRAGMA foreign_keys", "foreign_keys"), 1);

  sqlFile(upgraded, migration1);
  query(upgraded, "INSERT INTO users VALUES ('uid-a','a@example.test','A','2028-01-01','2028-01-01'); INSERT INTO users VALUES ('uid-b','b@example.test','B','2028-01-01','2028-01-01'); INSERT INTO subscriptions (firebase_uid,status_normalized,status_original,created_at,updated_at,last_verified_at) VALUES ('uid-a','active','authorized','2028-01-01','2028-01-01','2028-01-01'); INSERT INTO webhook_events VALUES ('event','subscription_preapproval','resource','2028-01-01','processed'); INSERT INTO rate_limits VALUES ('key',1,2)");
  sqlFile(upgraded, migration2);
  sqlFile(upgraded, migration3);
  assert.equal(scalar(upgraded, "SELECT COUNT(*) count FROM users", "count"), 2);
  assert.equal(scalar(upgraded, "SELECT COUNT(*) count FROM subscriptions", "count"), 1);
  assert.equal(scalar(upgraded, "SELECT COUNT(*) count FROM webhook_events", "count"), 1);
  assert.equal(scalar(upgraded, "SELECT count FROM rate_limits WHERE key='key'", "count"), 2);

  query(upgraded, "INSERT INTO sync_accounts (firebase_uid,sync_epoch,revision,created_at,updated_at) VALUES ('uid-a',1,0,'2028-01-01','2028-01-01'); INSERT INTO sync_accounts (firebase_uid,sync_epoch,revision,created_at,updated_at) VALUES ('uid-b',1,0,'2028-01-01','2028-01-01')");
  for (const uid of ["uid-a", "uid-b"])
    query(upgraded, `INSERT INTO sync_profiles VALUES ('${uid}','same-profile',1,1,0,NULL,'cipher','iv','fixture','2028-01-01','2028-01-01'); INSERT INTO sync_categories VALUES ('${uid}','same-category','expense:casa','expense',1,2,0,NULL,'cipher','iv','fixture','2028-01-01','2028-01-01')`);
  query(upgraded, "INSERT INTO sync_transactions VALUES ('uid-a','transaction-a','same-profile','same-category',NULL,'single:shared','2028-01-01','single','expense',1,3,1,'2028-01-02','cipher','iv','fixture','2028-01-01','2028-01-02')");
  assert.throws(() => query(upgraded, "INSERT INTO sync_transactions VALUES ('uid-a','transaction-duplicate','same-profile','same-category',NULL,'single:shared','2028-01-02','single','expense',1,4,0,NULL,'cipher','iv','fixture','2028-01-01','2028-01-02')"));
  query(upgraded, "INSERT INTO sync_transactions VALUES ('uid-b','transaction-b','same-profile','same-category',NULL,'single:shared','2028-01-02','single','expense',1,3,0,NULL,'cipher','iv','fixture','2028-01-01','2028-01-02')");
  assert.throws(() => query(upgraded, "INSERT INTO sync_transactions VALUES ('uid-a','cross-account','same-profile','missing-category',NULL,'single:cross','2028-01-03','single','expense',1,4,0,NULL,'cipher','iv','fixture','2028-01-01','2028-01-03')"));
  assert.equal(scalar(upgraded, "SELECT COUNT(*) count FROM sync_transactions WHERE firebase_uid='uid-a'", "count"), 1);
  assert.equal(scalar(upgraded, "SELECT COUNT(*) count FROM sync_transactions WHERE firebase_uid='uid-b'", "count"), 1);
  console.log("D1 local: migrations, foreign keys, indexes, isolation and occurrenceKey validated.");
} finally {
  await rm(root, { recursive: true, force: true });
}
