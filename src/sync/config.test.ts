import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("kill switch da sincronização", () => {
  it("não habilita transporte remoto na Fase 1", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "true");
    vi.resetModules();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { canUseRemoteSync } = await import("./config");
    expect(canUseRemoteSync()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
