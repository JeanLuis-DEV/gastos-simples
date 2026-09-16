import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../_shared/auth", () => ({ authenticate: vi.fn() }));
vi.mock("../../_shared/rateLimit", () => ({ rateLimit: vi.fn() }));
vi.mock("../../_shared/syncAccess", () => ({ ensureSyncAccount: vi.fn(async () => ({ sync_epoch: 4 })), rateLimitSync: vi.fn(), requireRecentAuthentication: vi.fn() }));
vi.mock("../../_shared/syncEngine", () => ({ exportRemoteData: vi.fn(async () => ({ schemaVersion: 1, data: {} })) }));

import { authenticate } from "../../_shared/auth";
import { exportRemoteData } from "../../_shared/syncEngine";
import type { D1PreparedStatement, Env, PagesContext } from "../../types";
import { onRequestPost as deletionIntent } from "./deletion-intent";
import { onRequestGet as exportData } from "./export";

const mockedAuthenticate = vi.mocked(authenticate);
const mockedExport = vi.mocked(exportRemoteData);

function context(path: string, method: string): { context: PagesContext; binds: unknown[][] } {
  const binds: unknown[][] = [];
  const statement = {
    bind(...values: unknown[]) { binds.push(values); return this; }, first: vi.fn(async () => null), run: vi.fn(async () => ({ success: true })), all: vi.fn(async () => ({ success: true, results: [] })),
  } as D1PreparedStatement;
  return { context: {
    request: new Request(`https://app.test${path}`, { method }),
    env: { DB: { prepare: vi.fn(() => statement), batch: vi.fn(async () => []) }, APP_ORIGIN: "https://app.test", FIREBASE_PROJECT_ID: "project" } as unknown as Env,
    waitUntil: vi.fn(),
  }, binds };
}

describe("direitos de exportação e exclusão", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuthenticate.mockResolvedValue({ uid: "authenticated-uid", email: "user@example.test", authTime: Math.floor(Date.now() / 1000) });
  });

  it("exporta pela identidade autenticada sem consultar assinatura", async () => {
    const { context: ctx } = context("/api/data/export", "GET");
    expect((await exportData(ctx)).status).toBe(200);
    expect(mockedExport).toHaveBeenCalledWith(ctx.env, "authenticated-uid", { cursor: 0, untilRevision: undefined, limit: 200 });
  });

  it("armazena somente o hash do nonce de exclusão", async () => {
    const { context: ctx, binds } = context("/api/data/deletion-intent", "POST");
    const response = await deletionIntent(ctx);
    const result = await response.json() as { nonce: string };
    expect(response.status).toBe(200);
    expect(result.nonce.length).toBeGreaterThan(20);
    expect(binds.flat()).not.toContain(result.nonce);
    expect(binds[0]?.[0]).toBe("authenticated-uid");
  });
});
