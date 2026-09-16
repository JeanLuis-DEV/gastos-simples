import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/auth", () => ({ getIdToken: vi.fn() }));
vi.mock("../config", () => ({ getPublicConfig: () => ({ apiBaseUrl: "/api" }) }));

import { getIdToken } from "../services/auth";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getIdToken).mockResolvedValue("token");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("cliente remoto de sincronização", () => {
  it("não autentica nem envia request com o kill switch desligado", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "false");
    vi.resetModules();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { syncApi } = await import("./client");
    await expect(syncApi.status()).rejects.toMatchObject({ code: "disabled" });
    expect(getIdToken).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renova o token uma única vez após 401 sem expor dados em erros", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "true");
    vi.resetModules();
    vi.mocked(getIdToken).mockResolvedValueOnce("old-token").mockResolvedValueOnce("new-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Sessão inválida." }), { status: 401, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ protocolVersion: 1, available: true, enabled: false, syncEpoch: 1, highWatermark: 0, canPush: false, canPull: false, canExport: true, canDelete: true, serverTime: "2028-01-01T00:00:00.000Z" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const { syncApi } = await import("./client");
    await expect(syncApi.status()).resolves.toMatchObject({ available: true });
    expect(getIdToken).toHaveBeenNthCalledWith(1, false);
    expect(getIdToken).toHaveBeenNthCalledWith(2, true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
