import { afterEach, describe, expect, it, vi } from "vitest";
import { SYNC_PRIVACY_POLICY_URL as DEFAULT_SYNC_PRIVACY_POLICY_URL } from "../../shared/syncPolicy";
import { resolveSyncPrivacyPolicyUrl } from "./config";

describe("configuração pública da sincronização", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("aceita somente uma URL HTTPS explícita para a política do ambiente", () => {
    expect(resolveSyncPrivacyPolicyUrl("https://staging.example/politica")).toBe(
      "https://staging.example/politica",
    );
    expect(resolveSyncPrivacyPolicyUrl("http://inseguro.example")).toBe(
      DEFAULT_SYNC_PRIVACY_POLICY_URL,
    );
    expect(resolveSyncPrivacyPolicyUrl("não-é-url")).toBe(
      DEFAULT_SYNC_PRIVACY_POLICY_URL,
    );
  });

  it("mantém o canário restrito ao entitlement administrativo", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "true");
    vi.stubEnv("VITE_SYNC_CANARY_ADMIN_ONLY", "true");
    vi.resetModules();
    const { canUseRemoteSyncForEntitlement } = await import("./config");
    expect(canUseRemoteSyncForEntitlement("admin")).toBe(true);
    expect(canUseRemoteSyncForEntitlement("active")).toBe(false);
    expect(canUseRemoteSyncForEntitlement("trial")).toBe(false);
  });
});
