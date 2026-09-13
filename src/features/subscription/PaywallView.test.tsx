import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PaywallView } from "./PaywallView";
import { InstitutionalContent } from "../dashboard/InstitutionalContent";
describe("gating Premium", () => {
  it("não renderiza aplicativo e apresenta oferta exata sem entitlement", () => {
    render(
      <PaywallView
        entitlement={{ status: "none", hasAccess: false }}
        loading={false}
        onStart={vi.fn()}
        onRefresh={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    expect(screen.getByText("Gastos Simples Premium")).toBeTruthy();
    expect(screen.getByText("7 dias grátis")).toBeTruthy();
    expect(screen.getByText("depois R$ 4,99 por mês")).toBeTruthy();
    expect(screen.queryByText("Resumo financeiro")).toBeNull();
  });
  it("mostra erro e não oferece teste para assinatura pausada", () => {
    render(
      <PaywallView
        entitlement={{ status: "paused", hasAccess: false }}
        error="Falha de consulta"
        loading={false}
        onStart={vi.fn()}
        onRefresh={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    expect(screen.getByText("Falha de consulta")).toBeTruthy();
    expect(screen.queryByText("Começar teste grátis")).toBeNull();
  });

  it("mantém as informações institucionais alinhadas à oferta pública", () => {
    render(<InstitutionalContent />);
    expect(screen.getByText(/Plano mensal de R\$ 4,99/)).toBeTruthy();
    expect(screen.queryByText(/R\$ 1,99/)).toBeNull();
  });
});
