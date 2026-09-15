// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";
import type { D1Database, Env } from "../types";
import { pullSync, pushSync } from "./syncEngine";
import type { PushRequest } from "./syncValidation";

const migration1 = readFileSync(resolve("migrations/0001_initial.sql"), "utf8");
const migration2 = readFileSync(resolve("migrations/0002_sync.sql"), "utf8");
const encryptionKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(19)));
const instances: Miniflare[] = [];

async function applyMigration(DB: D1Database, sql: string) {
  const statements = sql.split(";").map((statement) => statement.trim()).filter(Boolean);
  await DB.batch(statements.map((statement) => DB.prepare(statement)));
}

async function environment() {
  const instance = new Miniflare(convertV4MiniflareOptions({
    compatibilityDate: "2025-01-01",
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: crypto.randomUUID() },
  }));
  instances.push(instance);
  const DB = await instance.getD1Database("DB");
  await applyMigration(DB, migration1);
  await applyMigration(DB, migration2);
  await DB.batch([
    DB.prepare("INSERT INTO users (firebase_uid,email,created_at,updated_at) VALUES (?,?,?,?)").bind("uid-a", "a@example.test", "2028-01-01", "2028-01-01"),
    DB.prepare("INSERT INTO sync_accounts (firebase_uid,sync_epoch,revision,activated_at,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("uid-a", 1, 0, "2028-01-01", "2028-01-01", "2028-01-01"),
  ]);
  return {
    DB,
    APP_ORIGIN: "https://app.test",
    FIREBASE_PROJECT_ID: "project",
    SYNC_ENABLED: "true",
    SYNC_ACTIVE_KEY_ID: "test-v1",
    SYNC_ENCRYPTION_KEYS: JSON.stringify({ "test-v1": encryptionKey }),
  } as Env;
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

describe("sincronização com D1 local real", () => {
  it("grava dependências em ordem, cifra o conteúdo, faz pull e repete o lote com segurança", async () => {
    const env = await environment();
    const body: PushRequest = {
      protocolVersion: 1,
      syncEpoch: 1,
      batchId: "batch-real-1",
      deviceId: "device-real-1",
      operations: [
        { command: "upsert-record", mutationId: "mutation-transaction", entityType: "transaction", recordId: "transaction-1", baseVersion: 0, payload: { profileId: "profile-1", occurrenceKey: "single:transaction-1", description: "Conteúdo financeiro confidencial", amountCents: 12345, type: "expense", status: "pending", dueDate: "2028-02-01", categoryId: "category-1", categoryName: "Casa", notes: "observação confidencial", kind: "single" } },
        { command: "upsert-record", mutationId: "mutation-category", entityType: "category", recordId: "category-1", baseVersion: 0, payload: { name: "Casa", type: "expense", isDefault: false } },
        { command: "upsert-record", mutationId: "mutation-profile", entityType: "profile", recordId: "profile-1", baseVersion: 0, payload: { name: "Principal" } },
      ],
    };
    const first = await pushSync(env, { uid: "uid-a", email: "a@example.test" }, body);
    expect(first).toMatchObject({ batchId: body.batchId, committedRevision: 3, highWatermark: 3 });
    const stored = await env.DB.prepare("SELECT payload_ciphertext FROM sync_transactions WHERE firebase_uid=? AND record_id=?").bind("uid-a", "transaction-1").first<{ payload_ciphertext: string }>();
    expect(stored?.payload_ciphertext).not.toContain("Conteúdo financeiro confidencial");
    const pulled = await pullSync(env, "uid-a", { cursor: 0, untilRevision: 3, limit: 200, epoch: 1, deviceId: "device-real-1", protocolVersion: 1 });
    expect(pulled).toMatchObject({ cursor: 3, highWatermark: 3, hasMore: false });
    expect(pulled.records).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: "transaction", payload: expect.objectContaining({ amountCents: 12345 }) })]));
    await expect(pushSync(env, { uid: "uid-a", email: "a@example.test" }, body)).resolves.toEqual(first);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM sync_transactions WHERE firebase_uid=?").bind("uid-a").first<{ count: number }>()).toEqual({ count: 1 });
  });
});
