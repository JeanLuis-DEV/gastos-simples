import { beforeEach, describe, expect, it } from "vitest";
import { clearUserDataForTesting } from "../storage/database";
import { hasValidOfflineLease, invalidateSyncLease, recordSuccessfulEntitlement } from "./engine";

beforeEach(async () => {
  await clearUserDataForTesting("lease-owner");
});

describe("lease offline", () => {
  it("vale por sete dias e é invalidado por expiração, relógio regressivo ou logout", async () => {
    const verified = new Date();
    await recordSuccessfulEntitlement("lease-owner", verified.toISOString());
    expect(await hasValidOfflineLease("lease-owner", verified.getTime() + 7 * 24 * 60 * 60 * 1000)).toBe(true);
    expect(await hasValidOfflineLease("lease-owner", verified.getTime() + 7 * 24 * 60 * 60 * 1000 + 1)).toBe(false);
    expect(await hasValidOfflineLease("lease-owner", verified.getTime() - 1)).toBe(false);
    await invalidateSyncLease("lease-owner");
    expect(await hasValidOfflineLease("lease-owner", verified.getTime())).toBe(false);
  });

  it("recusa validação quando o relógio diverge excessivamente do servidor", async () => {
    await expect(recordSuccessfulEntitlement("lease-owner", new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())).rejects.toThrow(/data deste dispositivo/);
  });
});
