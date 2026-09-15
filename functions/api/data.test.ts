import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_shared/auth", () => ({ authenticate: vi.fn() }));
vi.mock("../_shared/rateLimit", () => ({ rateLimit: vi.fn() }));
vi.mock("../_shared/syncAccess", () => ({ ensureSyncAccount: vi.fn(async () => ({ sync_epoch: 7 })), rateLimitSync: vi.fn(), requireRecentAuthentication: vi.fn() }));
vi.mock("../_shared/syncEngine", () => ({ deleteFinancialData: vi.fn(async () => 8) }));

import { authenticate } from "../_shared/auth";
import { deleteFinancialData } from "../_shared/syncEngine";
import type { D1PreparedStatement, Env, PagesContext } from "../types";
import { onRequestDelete } from "./data";

const mockedAuthenticate = vi.mocked(authenticate);
const mockedDelete = vi.mocked(deleteFinancialData);

function context(value: unknown): PagesContext {
  const statement = { bind() { return this; }, first: vi.fn(async () => null), run: vi.fn(async () => ({ success: true })), all: vi.fn(async () => ({ success: true, results: [] })) } as D1PreparedStatement;
  return {
    request: new Request("https://app.test/api/data", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
    env: { DB: { prepare: vi.fn(() => statement), batch: vi.fn(async () => []) }, APP_ORIGIN: "https://app.test", FIREBASE_PROJECT_ID: "project" } as unknown as Env,
    waitUntil: vi.fn(),
  };
}

describe("exclusão financeira remota", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuthenticate.mockResolvedValue({ uid: "authenticated-uid", email: "user@example.test", authTime: Math.floor(Date.now() / 1000) });
  });

  it("usa UID autenticado, nonce hash e incrementa epoch sem alegar exclusão local/contábil", async () => {
    const response = await onRequestDelete(context({ nonce: "one-time-nonce" }));
    expect(response.status).toBe(200);
    expect(mockedDelete).toHaveBeenCalledWith(expect.anything(), "authenticated-uid", expect.any(String), 7, expect.any(Date), { nonceHash: expect.any(String) });
    expect(await response.json()).toMatchObject({ deleted: true, syncEpoch: 8, localDataDeleted: false, accountDeleted: false, subscriptionDeleted: false });
  });

  it("rejeita mass assignment", async () => {
    const response = await onRequestDelete(context({ nonce: "one-time-nonce", ownerUid: "other" }));
    expect(response.status).toBe(400);
    expect(mockedDelete).not.toHaveBeenCalled();
  });
});
