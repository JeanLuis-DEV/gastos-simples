import { beforeEach, describe, expect, it, vi } from "vitest";
import { SYNC_PRIVACY_POLICY_VERSION } from "../../shared/syncPolicy";
import { clearUserDataForTesting, getSyncState } from "../storage/database";

vi.mock("./config", () => ({ canUseRemoteSync: () => true, SYNC_PROTOCOL_VERSION: 1 }));
vi.mock("./client", () => ({
  SyncHttpError: class SyncHttpError extends Error {},
  syncApi: {
    activate: vi.fn(async () => ({ enabled: true, syncEpoch: 2, highWatermark: 0, consentAcceptedAt: "2028-01-01T00:00:00.000Z" })),
  },
}));

describe("registro local do consentimento", () => {
  beforeEach(async () => clearUserDataForTesting("consent-owner"));

  it("persiste a versão estável e a data autoritativa devolvida pelo servidor", async () => {
    const { SyncManager } = await import("./engine");
    await new SyncManager("consent-owner").activate();
    expect(await getSyncState("consent-owner")).toMatchObject({
      enabled: true,
      consentVersion: SYNC_PRIVACY_POLICY_VERSION,
      consentAcceptedAt: "2028-01-01T00:00:00.000Z",
      epoch: 2,
    });
  });
});
