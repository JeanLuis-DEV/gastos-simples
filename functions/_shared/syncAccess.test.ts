import { describe, expect, it, vi } from "vitest";
import type { D1PreparedStatement, Env } from "../types";
import { hasRemoteFinancialData, isSyncCanaryAllowed, rateLimitSync, requirePublishedSyncPolicy, requirePushEntitlement, requireRecentAuthentication, requireSyncEnabled, syncEntitlement, updateRetention } from "./syncAccess";
import { SYNC_PRIVACY_POLICY_LABEL } from "../../shared/syncPolicy";

function environment(subscription?: { mp_subscription_id: string | null; status_normalized: string; end_at: string | null }, hasRemoteData = false) {
  const statements: Array<{ query: string; values: unknown[] }> = [];
  const DB = {
    prepare: vi.fn((query: string) => {
      const entry = { query, values: [] as unknown[] };
      statements.push(entry);
      return {
        bind(...values: unknown[]) { entry.values = values; return this; },
        first: vi.fn(async () => query.includes("FROM subscriptions") ? subscription ?? null : query.includes("AS has_data") ? { has_data: hasRemoteData ? 1 : 0 } : query.includes("INSERT INTO rate_limits") ? { count: 1 } : null),
        run: vi.fn(async () => ({ success: true })),
        all: vi.fn(async () => ({ success: true, results: [] })),
      } as D1PreparedStatement;
    }),
    batch: vi.fn(async () => []),
  };
  return { env: { DB, APP_ORIGIN: "https://app.test", FIREBASE_PROJECT_ID: "project" } as unknown as Env, statements };
}

describe("acesso e retenção da sincronização", () => {
  it("mantém o kill switch fechado salvo valor literal true", () => {
    expect(() => requireSyncEnabled({ SYNC_ENABLED: "false" } as Env)).toThrow();
    expect(() => requireSyncEnabled({ SYNC_ENABLED: "true" } as Env)).not.toThrow();
  });

  it("bloqueia escrita enquanto a versão pública esperada não estiver configurada", () => {
    expect(() => requirePublishedSyncPolicy({ SYNC_POLICY_VERSION: "pending" } as Env)).toThrow();
    expect(() => requirePublishedSyncPolicy({ SYNC_POLICY_VERSION: SYNC_PRIVACY_POLICY_LABEL } as Env)).not.toThrow();
  });

  it("restringe o canário ao UID administrativo sem versionar identificadores", () => {
    const env = { SYNC_CANARY_ADMIN_ONLY: "true", ADMIN_FIREBASE_UIDS: "uid-admin" } as Env;
    expect(isSyncCanaryAllowed("uid-admin", env)).toBe(true);
    expect(isSyncCanaryAllowed("uid-comum", env)).toBe(false);
    expect(isSyncCanaryAllowed("uid-comum", { ...env, SYNC_CANARY_ADMIN_ONLY: "false" })).toBe(true);
  });

  it.each(["trial", "active"])("permite push para %s", async (status) => {
    const { env } = environment({ mp_subscription_id: null, status_normalized: status, end_at: null });
    expect(await syncEntitlement({ uid: "uid", email: "u@example.test" }, env)).toBe(status);
    expect(() => requirePushEntitlement(status as "trial" | "active")).not.toThrow();
  });

  it.each(["paused", "cancelled", "expired", "none"])("bloqueia push para %s", (status) =>
    expect(() => requirePushEntitlement(status as "paused")).toThrow());

  it("exige autenticação dos últimos cinco minutos para exclusão", () => {
    expect(() => requireRecentAuthentication({ uid: "uid", email: "u@example.test", authTime: 970 }, 1_000)).not.toThrow();
    expect(() => requireRecentAuthentication({ uid: "uid", email: "u@example.test", authTime: 699 }, 1_000)).toThrow();
  });

  it("calcula retenção de 90 dias no servidor e a cancela na reativação", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2028-01-01T00:00:00.000Z"));
    const { env, statements } = environment();
    await updateRetention(env, "uid", "cancelled");
    expect(statements.at(-1)?.values).toContain("2028-03-31T00:00:00.000Z");
    await updateRetention(env, "uid", "active");
    expect(statements.at(-1)?.query).toContain("purge_after=NULL");
    vi.useRealTimers();
  });

  it("aplica limites separados por UID e IP sem persistir identificadores brutos", async () => {
    const { env, statements } = environment();
    await rateLimitSync(env, new Request("https://app.test", { headers: { "CF-Connecting-IP": "203.0.113.10" } }), "firebase-uid-confidencial", "push", 10);
    const persisted = JSON.stringify(statements);
    expect(persisted).not.toContain("firebase-uid-confidencial");
    expect(persisted).not.toContain("203.0.113.10");
    expect(statements.filter(({ query }) => query.includes("INSERT INTO rate_limits"))).toHaveLength(2);
  });

  it("confirma dados remotos no backend sem inferir pelo estado local", async () => {
    expect(await hasRemoteFinancialData(environment(undefined, false).env, "uid")).toBe(false);
    expect(await hasRemoteFinancialData(environment(undefined, true).env, "uid")).toBe(true);
  });
});
