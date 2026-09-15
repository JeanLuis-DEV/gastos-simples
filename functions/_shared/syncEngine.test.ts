import { describe, expect, it, vi } from "vitest";
import type { D1PreparedStatement, Env } from "../types";
import { contentHash, encryptPayload } from "./syncCrypto";
import { deleteFinancialData, pullSync, pushSync } from "./syncEngine";
import type { PushRequest } from "./syncValidation";

const fixtureKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
type Entry = { query: string; values: unknown[] };

function environment(handlers: {
  first?: (entry: Entry) => unknown;
  all?: (entry: Entry) => unknown[];
  batch?: (entries: Entry[]) => Promise<unknown>;
} = {}) {
  const entries: Entry[] = [];
  let batches: Entry[][] = [];
  const DB = {
    prepare: vi.fn((query: string) => {
      const entry = { query, values: [] as unknown[] };
      entries.push(entry);
      return {
        bind(...values: unknown[]) { entry.values = values; return this; },
        first: vi.fn(async () => handlers.first?.(entry) ?? null),
        run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
        all: vi.fn(async () => ({ success: true, results: handlers.all?.(entry) ?? [] })),
      } as D1PreparedStatement;
    }),
    batch: vi.fn(async (statements: D1PreparedStatement[]) => {
      const selected = entries.slice(-statements.length);
      batches.push(selected);
      if (handlers.batch) await handlers.batch(selected);
      return statements.map(() => ({ success: true }));
    }),
  };
  return {
    env: {
      DB,
      APP_ORIGIN: "https://app.test",
      FIREBASE_PROJECT_ID: "project",
      MERCADO_PAGO_ACCESS_TOKEN: "fixture",
      MERCADO_PAGO_PLAN_ID: "fixture",
      SYNC_ENABLED: "true",
      SYNC_ACTIVE_KEY_ID: "fixture-v1",
      SYNC_ENCRYPTION_KEYS: JSON.stringify({ "fixture-v1": fixtureKey }),
    } as Env,
    entries,
    get batches() { return batches; },
  };
}

const profilePush: PushRequest = {
  protocolVersion: 1,
  syncEpoch: 1,
  batchId: "batch-1",
  deviceId: "device-1",
  operations: [{ command: "upsert-record", mutationId: "mutation-1", entityType: "profile", recordId: "profile-1", baseVersion: 0, payload: { name: "Perfil confidencial" } }],
};

describe("engine de push", () => {
  it("gera versão/revisão no servidor e persiste payload somente cifrado", async () => {
    const fixture = environment({
      first: ({ query }) => query.includes("FROM sync_accounts") ? { sync_epoch: 1, revision: 0, activated_at: "2028-01-01", disabled_at: null } : null,
    });
    const response = await pushSync(fixture.env, { uid: "uid-a", email: "a@example.test" }, profilePush);
    expect(response).toMatchObject({ batchId: "batch-1", syncEpoch: 1, committedRevision: 1, highWatermark: 1, serverTime: expect.any(String), results: [{ status: "applied", records: [{ version: 1, revision: 1 }] }] });
    const persisted = JSON.stringify(fixture.batches);
    expect(persisted).not.toContain("Perfil confidencial");
    expect(persisted).not.toContain("amountCents");
    expect(fixture.batches[0]?.every((entry) => !entry.query.includes("uid-a"))).toBe(true);
  });

  it("reproduz lote idempotente e rejeita reutilização com conteúdo diferente", async () => {
    const response = { protocolVersion: 1, syncEpoch: 1, highWatermark: 1, results: [] };
    const hash = await contentHash(profilePush);
    const fixture = environment({
      first: ({ query }) => query.includes("FROM sync_accounts")
        ? { sync_epoch: 1, revision: 1, activated_at: "2028-01-01", disabled_at: null }
        : query.includes("FROM sync_batches") ? { content_hash: hash, response_json: JSON.stringify(response) } : null,
    });
    await expect(pushSync(fixture.env, { uid: "uid-a", email: "a@example.test" }, profilePush)).resolves.toEqual(response);
    await expect(pushSync(fixture.env, { uid: "uid-a", email: "a@example.test" }, { ...profilePush, deviceId: "changed-device" })).rejects.toMatchObject({ status: 409 });
  });

  it("falha de guarda concorrente não deixa sucesso parcial", async () => {
    const fixture = environment({
      first: ({ query }) => query.includes("FROM sync_accounts") ? { sync_epoch: 1, revision: 0, activated_at: "2028-01-01", disabled_at: null } : null,
      batch: async () => { throw new Error("constraint guard"); },
    });
    await expect(pushSync(fixture.env, { uid: "uid-a", email: "a@example.test" }, profilePush)).rejects.toMatchObject({ status: 409 });
  });
});

describe("engine de pull, exclusão e epoch", () => {
  it("faz pull pelo cursor/highWatermark usando o snapshot cifrado da revisão", async () => {
    const encrypted = await encryptPayload(environment().env, "uid-a", "profile", "profile-1", { name: "Principal" });
    const fixture = environment({
      first: ({ query }) => query.includes("MIN(revision)") ? { minimum: 1 } : query.includes("FROM sync_accounts") ? { sync_epoch: 2, revision: 3, activated_at: "2028-01-01", disabled_at: null } : null,
      all: ({ query, values }) => query.includes("FROM sync_changes") && values[2] !== 2 ? [{ revision: 3, entity_type: "profile", record_id: "profile-1", version: 2, is_deleted: 0, deleted_at: null, payload_ciphertext: encrypted.payloadCiphertext, payload_iv: encrypted.payloadIv, key_id: encrypted.keyId }] : [],
    });
    await expect(pullSync(fixture.env, "uid-a", { cursor: 2, limit: 200, epoch: 2, deviceId: "device", protocolVersion: 1 })).resolves.toMatchObject({ cursor: 3, highWatermark: 3, hasMore: false, records: [{ payload: { name: "Principal" } }] });
    await expect(pullSync(fixture.env, "uid-a", { cursor: 2, untilRevision: 2, limit: 200, epoch: 2, deviceId: "device", protocolVersion: 1 })).resolves.toMatchObject({ cursor: 2, highWatermark: 2, hasMore: false, records: [] });
    await expect(pullSync(fixture.env, "uid-a", { cursor: 2, limit: 200, epoch: 1, deviceId: "device", protocolVersion: 1 })).rejects.toMatchObject({ status: 410 });
  });

  it("exclusão apaga apenas tabelas financeiras e incrementa syncEpoch", async () => {
    const fixture = environment();
    await expect(deleteFinancialData(fixture.env, "uid-a", "request", 7, new Date("2028-01-01T00:00:00.000Z"), { nonceHash: "nonce-hash" })).resolves.toBe(8);
    const queries = fixture.batches[0]!.map(({ query }) => query).join("\n");
    expect(queries).toContain("UPDATE sync_accounts SET sync_epoch=?");
    expect(queries).toContain("DELETE FROM sync_transactions");
    expect(queries).not.toMatch(/DELETE FROM (users|subscriptions|webhook_events|rate_limits)/);
    expect(fixture.batches[0]![0]!.values).toContain("nonce-hash");
  });
});
