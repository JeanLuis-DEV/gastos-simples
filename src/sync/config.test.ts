import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("kill switch da sincronização", () => {
  it("só libera o transporte com o valor literal true e não faz requests ao consultar", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "true");
    vi.resetModules();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { canUseRemoteSync } = await import("./config");
    expect(canUseRemoteSync()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("permanece fechado por padrão", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "false");
    vi.resetModules();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { canUseRemoteSync } = await import("./config");
    expect(canUseRemoteSync()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
