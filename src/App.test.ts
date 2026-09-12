import { describe, expect, it } from "vitest";
import { checkoutUrl, subscriptionReturnError } from "./App";

describe("retorno e checkout do Mercado Pago", () => {
  it("aceita somente checkout HTTPS do Mercado Pago", () => {
    expect(
      checkoutUrl("https://www.mercadopago.com.br/subscriptions/checkout")
        .hostname,
    ).toBe("www.mercadopago.com.br");
    expect(() => checkoutUrl("https://example.test/checkout")).toThrow(
      /URL de checkout válida/,
    );
    expect(() => checkoutUrl("http://www.mercadopago.com.br/checkout")).toThrow(
      /URL de checkout válida/,
    );
  });
  it("expõe falha informada no retorno sem tratar a URL como entitlement", () => {
    expect(
      subscriptionReturnError("?assinatura=retorno&status=rejected"),
    ).toMatch(/não foi concluída/);
    expect(subscriptionReturnError("?assinatura=retorno&status=approved")).toBe(
      "",
    );
  });
});
