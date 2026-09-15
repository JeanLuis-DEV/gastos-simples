import { describe, expect, it } from "vitest";
import { threeWayMergePayload } from "./syncRecords";

describe("conflitos determinísticos do backend", () => {
  it("mescla alterações em campos diferentes sem usar relógio do dispositivo", () => {
    const result = threeWayMergePayload(
      { description: "Base", amountCents: 100 },
      { description: "Local", amountCents: 100 },
      { description: "Base", amountCents: 200 },
    );
    expect(result).toEqual({ value: { description: "Local", amountCents: 200 }, conflicts: [] });
  });

  it("preserva conflito quando o mesmo campo mudou", () => {
    const result = threeWayMergePayload(
      { description: "Base" },
      { description: "Local" },
      { description: "Remoto" },
    );
    expect(result).toEqual({ value: { description: "Remoto" }, conflicts: ["description"] });
  });
});
