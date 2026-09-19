import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../_shared/auth", () => ({ authenticate: vi.fn() }));
vi.mock("../../_shared/rateLimit", () => ({ rateLimit: vi.fn() }));
vi.mock("../../_shared/syncAccess", async () => {
  const { HttpError } = await import("../../_shared/http");
  return {
    ensureSyncAccount: vi.fn(async () => ({ sync_epoch: 1, revision: 0, activated_at: "2028-01-01", disabled_at: null })),
    rateLimitSync: vi.fn(),
    requirePushEntitlement: vi.fn(),
    requireSyncEntitlement: vi.fn(),
    requireSyncEnabled: vi.fn((env: { SYNC_ENABLED?: string }) => { if (env.SYNC_ENABLED !== "true") throw new HttpError(503, "Sincronização indisponível."); }),
    requirePublishedSyncPolicy: vi.fn(),
    isSyncPolicyPublished: vi.fn(() => true),
    requireSyncCanaryAccess: vi.fn(),
    isSyncCanaryAllowed: vi.fn(() => true),
    isSyncEntitlementEligible: vi.fn((status: string) => ["trial", "active", "admin"].includes(status)),
    hasRemoteFinancialData: vi.fn(async () => true),
    syncEntitlement: vi.fn(async () => "active"),
    updateRetention: vi.fn(),
  };
});
vi.mock("../../_shared/syncEngine", () => ({
  pushSync: vi.fn(async () => ({ protocolVersion: 1, syncEpoch: 1, highWatermark: 1, results: [] })),
  pullSync: vi.fn(async () => ({ protocolVersion: 1, syncEpoch: 1, highWatermark: 0, cursor: 0, hasMore: false, records: [] })),
}));

import { authenticate } from "../../_shared/auth";
import { HttpError } from "../../_shared/http";
import { requireSyncEntitlement, syncEntitlement } from "../../_shared/syncAccess";
import { pullSync, pushSync } from "../../_shared/syncEngine";
import type { D1PreparedStatement, Env, PagesContext } from "../../types";
import { onRequestPost as activate } from "./activate";
import { onRequestPost as disable } from "./disable";
import { onRequestGet as pull } from "./pull";
import { onRequestPost as push } from "./push";
import { onRequestGet as status } from "./status";
import { SYNC_PRIVACY_POLICY_LABEL, SYNC_PRIVACY_POLICY_VERSION } from "../../../shared/syncPolicy";

const mockedAuthenticate = vi.mocked(authenticate);
const mockedRequireSyncEntitlement = vi.mocked(requireSyncEntitlement);
const mockedSyncEntitlement = vi.mocked(syncEntitlement);
const mockedPull = vi.mocked(pullSync);
const mockedPush = vi.mocked(pushSync);
const body = {
  protocolVersion: 1, syncEpoch: 1, batchId: "batch", deviceId: "device",
  operations: [{ command: "upsert-record", mutationId: "mutation", entityType: "profile", recordId: "profile", baseVersion: 0, payload: { name: "Principal" } }],
};

function context(syncEnabled = "true", value: unknown = body, path = "/api/sync/push", method = "POST"): PagesContext {
  const statement = {
    bind() { return this; }, first: vi.fn(async () => null), run: vi.fn(async () => ({ success: true })), all: vi.fn(async () => ({ success: true, results: [] })),
  } as D1PreparedStatement;
  return {
    request: new Request(`https://app.test${path}`, { method, headers: method === "POST" ? { "Content-Type": "application/json" } : undefined, body: method === "POST" ? JSON.stringify(value) : undefined }),
    env: {
      DB: { prepare: vi.fn(() => statement), batch: vi.fn(async () => []) },
      APP_ORIGIN: "https://app.test", FIREBASE_PROJECT_ID: "project", MERCADO_PAGO_ACCESS_TOKEN: "fixture", MERCADO_PAGO_PLAN_ID: "fixture", SYNC_ENABLED: syncEnabled, SYNC_POLICY_VERSION: SYNC_PRIVACY_POLICY_LABEL,
    } as Env,
    waitUntil: vi.fn(),
  };
}

describe("endpoints de sincronização", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuthenticate.mockResolvedValue({ uid: "authenticated-uid", email: "user@example.test", authTime: Math.floor(Date.now() / 1000) });
  });

  it("recusa push pelo kill switch antes de autenticar ou tocar no D1", async () => {
    const ctx = context("false");
    const response = await push(ctx);
    expect(response.status).toBe(503);
    expect(mockedAuthenticate).not.toHaveBeenCalled();
    expect(ctx.env.DB.prepare).not.toHaveBeenCalled();
  });

  it("usa somente o UID autenticado e não aceita ownerUid no contrato", async () => {
    const response = await push(context("true"));
    expect(response.status).toBe(200);
    expect(mockedPush).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ uid: "authenticated-uid" }), expect.not.objectContaining({ ownerUid: expect.anything() }));
    const malicious = await push(context("true", { ...body, ownerUid: "other-account" }));
    expect(malicious.status).toBe(400);
    expect(mockedPush).toHaveBeenCalledTimes(1);
  });

  it("não devolve detalhes internos quando o backend falha", async () => {
    mockedPush.mockRejectedValueOnce(new Error("SQL payload Salário 100000"));
    const response = await push(context("true"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Serviço temporariamente indisponível." });
  });

  it("mantém activate e pull fechados, mas status e disable disponíveis", async () => {
    expect((await activate(context("false", { protocolVersion: 1, deviceId: "device", consentVersion: SYNC_PRIVACY_POLICY_VERSION }, "/api/sync/activate", "POST"))).status).toBe(503);
    expect((await pull(context("false", undefined, "/api/sync/pull?cursor=0&limit=1&epoch=1&deviceId=device&protocolVersion=1", "GET"))).status).toBe(503);
    const statusResponse = await status(context("false", undefined, "/api/sync/status", "GET"));
    expect(await statusResponse.json()).toMatchObject({ available: false, canExport: true, canDelete: true, hasRemoteData: true });
    const disableResponse = await disable(context("false", { deleteRemoteData: true }, "/api/sync/disable", "POST"));
    expect(await disableResponse.json()).toEqual({ enabled: false, deletionRequired: true });
  });

  it("ativa somente com consentimento e versão de protocolo explícitos", async () => {
    const validResponse = await activate(context("true", { protocolVersion: 1, deviceId: "device", consentVersion: SYNC_PRIVACY_POLICY_VERSION }, "/api/sync/activate", "POST"));
    expect(validResponse.status).toBe(200);
    const invalidResponse = await activate(context("true", { protocolVersion: 1, deviceId: "device", consentVersion: SYNC_PRIVACY_POLICY_VERSION, ownerUid: "other" }, "/api/sync/activate", "POST"));
    expect(invalidResponse.status).toBe(400);
  });

  it.each(["active", "trial", "admin"] as const)("permite pull para entitlement %s", async (entitlement) => {
    mockedSyncEntitlement.mockResolvedValueOnce(entitlement);
    const response = await pull(context("true", undefined, "/api/sync/pull?cursor=0&limit=1&epoch=1&deviceId=device&protocolVersion=1", "GET"));
    expect(response.status).toBe(200);
    expect(mockedRequireSyncEntitlement).toHaveBeenCalledWith(entitlement);
  });

  it.each(["cancelled", "expired", "none"] as const)("bloqueia pull para entitlement %s", async (entitlement) => {
    mockedSyncEntitlement.mockResolvedValueOnce(entitlement);
    mockedRequireSyncEntitlement.mockImplementationOnce(() => {
      throw new HttpError(403, "Sua assinatura não permite usar a sincronização.");
    });
    const response = await pull(context("true", undefined, "/api/sync/pull?cursor=0&limit=1&epoch=1&deviceId=device&protocolVersion=1", "GET"));
    expect(response.status).toBe(403);
    expect(mockedPull).not.toHaveBeenCalled();
  });

  it.each(["active", "trial", "admin"] as const)("informa sincronização disponível no status para entitlement %s", async (entitlement) => {
    mockedSyncEntitlement.mockResolvedValueOnce(entitlement);
    const response = await status(context("true", undefined, "/api/sync/status", "GET"));
    expect(await response.json()).toMatchObject({ available: true, canPush: true, canPull: true });
  });

  it.each(["cancelled", "expired", "none"] as const)("não disponibiliza sincronização no status para entitlement %s", async (entitlement) => {
    mockedSyncEntitlement.mockResolvedValueOnce(entitlement);
    const response = await status(context("true", undefined, "/api/sync/status", "GET"));
    expect(await response.json()).toMatchObject({ available: false, canPush: false, canPull: false });
  });

  it("bloqueia status sem autenticação", async () => {
    mockedAuthenticate.mockRejectedValueOnce(new HttpError(401, "Autenticação necessária."));
    const response = await status(context("true", undefined, "/api/sync/status", "GET"));
    expect(response.status).toBe(401);
  });
});
