import { describe, expect, it } from "vitest";
import { SYNC_PRIVACY_POLICY_URL as DEFAULT_SYNC_PRIVACY_POLICY_URL } from "../../shared/syncPolicy";
import { resolveSyncPrivacyPolicyUrl } from "./config";

describe("configuração pública da sincronização", () => {
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
});
