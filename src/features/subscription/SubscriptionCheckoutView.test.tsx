import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { initMercadoPago } = vi.hoisted(() => ({
  initMercadoPago: vi.fn(),
}));
vi.mock("@mercadopago/sdk-react", () => ({
  initMercadoPago,
  CardPayment: ({ onReady, onSubmit }: {
    onReady: () => void;
    onSubmit: (data: { token: string }) => Promise<void>;
  }) => (
    <button
      onClick={() => {
        onReady();
        void onSubmit({ token: "card_token_1234567890" });
      }}
    >
      Confirmar assinatura protegida
    </button>
  ),
}));

import { SubscriptionCheckoutView } from "./SubscriptionCheckoutView";

describe("checkout protegido do Mercado Pago", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tokeniza no SDK e envia somente o token à aplicação", async () => {
    const onSubscribe = vi.fn(async () => undefined);
    render(
      <SubscriptionCheckoutView
        email="user@example.test"
        publicKey="TEST-public-key-12345678901234567890"
        onBack={vi.fn()}
        onSubscribe={onSubscribe}
      />,
    );
    fireEvent.click(screen.getByText("Confirmar assinatura protegida"));
    await waitFor(() =>
      expect(onSubscribe).toHaveBeenCalledWith("card_token_1234567890"),
    );
    expect(initMercadoPago).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/enviados com segurança diretamente ao Mercado Pago/),
    ).toBeTruthy();
    expect(
      screen.getByText(/não vê nem armazena o número do cartão/),
    ).toBeTruthy();
  });
});
