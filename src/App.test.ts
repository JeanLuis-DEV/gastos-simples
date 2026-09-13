import { describe, expect, it } from "vitest";
import { subscriptionReturnError } from "./App";

describe("retorno e checkout do Mercado Pago", () => {
  it("expõe falha informada no retorno sem tratar a URL como entitlement", () => {
    expect(
      subscriptionReturnError("?assinatura=retorno&status=rejected"),
    ).toMatch(/não foi concluída/);
    expect(subscriptionReturnError("?assinatura=retorno&status=approved")).toBe(
      "",
    );
  });
});
