import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../services/api", () => ({
  cancelSubscription: vi.fn(),
}));

import { cancelSubscription } from "../../services/api";
import { SettingsView } from "./SettingsView";

describe("atualização da assinatura nos ajustes", () => {
  it("revoga o acesso local assim que o Mercado Pago confirma o cancelamento", async () => {
    const cancelled = { status: "cancelled" as const, hasAccess: false };
    vi.mocked(cancelSubscription).mockResolvedValue(cancelled);
    const onSubscriptionChanged = vi.fn();

    render(
      <SettingsView
        user={{
          uid: "cancel-user",
          displayName: "Usuário",
          email: "user@example.test",
          photoURL: null,
        }}
        entitlement={{ status: "trial", hasAccess: true }}
        onLogout={vi.fn()}
        onSubscriptionChanged={onSubscriptionChanged}
        onChanged={vi.fn(async () => undefined)}
        onError={vi.fn()}
        onMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancelar assinatura" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Cancelar assinatura" })).getByRole(
        "button",
        { name: "Solicitar cancelamento" },
      ),
    );

    await waitFor(() =>
      expect(onSubscriptionChanged).toHaveBeenCalledWith(cancelled),
    );
  });
});
