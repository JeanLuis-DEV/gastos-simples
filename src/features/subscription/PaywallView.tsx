import { Alert, Button, Card, Loading } from "@apps-simples/ui";
import { COMMERCIAL_PLAN_PRICE_LABEL } from "../../../shared/commercialPlan";
import type { Entitlement } from "../../domain/entitlement";

const messages: Record<Entitlement["status"], string> = {
  admin: "Seu acesso administrativo está ativo.",
  none: "Assine para liberar seu controle financeiro.",
  pending: "A assinatura está pendente de conclusão.",
  trial: "Seu período gratuito está ativo.",
  active: "Sua assinatura está ativa.",
  in_process: "O pagamento está em análise.",
  paused: "A assinatura está pausada.",
  cancelled: "A assinatura foi cancelada.",
  rejected: "O pagamento foi rejeitado.",
  expired: "A assinatura expirou.",
  temporary_error: "Não foi possível confirmar sua assinatura agora.",
};
export function PaywallView({
  entitlement,
  error,
  loading,
  onStart,
  onRefresh,
  onLogout,
}: {
  entitlement?: Entitlement;
  error?: string;
  loading: boolean;
  onStart: () => void;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const status = entitlement?.status ?? "none";
  const canStart = ["none", "cancelled", "rejected", "expired"].includes(
    status,
  );
  const startLabel =
    status === "cancelled" || status === "expired"
      ? "Assinar novamente"
      : status === "rejected"
        ? "Tentar nova assinatura"
        : "Começar teste grátis";
  return (
    <main className="public-shell">
      <section className="hero">
        <p className="eyebrow">Acesso completo</p>
        <h1>Gastos Simples Premium</h1>
        <p>
          Organize receitas, despesas, parcelas e recorrências sem anúncios.
        </p>
        <Card>
          <div className="offer-price">
            <strong>7 dias grátis</strong>
            <span>depois {COMMERCIAL_PLAN_PRICE_LABEL} por mês</span>
          </div>
          <ul>
            <li>Renovação recorrente pelo Mercado Pago</li>
            <li>Cancele quando quiser</li>
            <li>Dados financeiros somente neste navegador</li>
          </ul>
          {error && <Alert type="error">{error}</Alert>}
          {loading ? (
            <Loading label="Consultando assinatura" />
          ) : (
            entitlement &&
            entitlement.status !== "none" && (
              <Alert
                type={
                  entitlement.status === "temporary_error" ||
                  entitlement.status === "rejected"
                    ? "error"
                    : "info"
                }
              >
                {messages[entitlement.status]}
              </Alert>
            )
          )}
          <div className="button-row">
            {canStart && (
              <Button onClick={onStart} disabled={loading}>
                {startLabel}
              </Button>
            )}
            <Button variant="secondary" onClick={onRefresh} disabled={loading}>
              {status === "pending"
                ? "Verificar pagamento"
                : "Atualizar assinatura"}
            </Button>
          </div>
        </Card>
        <Button variant="ghost" onClick={onLogout}>
          Sair
        </Button>
      </section>
    </main>
  );
}
