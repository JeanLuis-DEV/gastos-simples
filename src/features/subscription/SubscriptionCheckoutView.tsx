import {
  CardPayment,
  initMercadoPago,
} from "@mercadopago/sdk-react";
import { Alert, Button, Card } from "@apps-simples/ui";
import { useState } from "react";
import { COMMERCIAL_PLAN } from "../../../shared/commercialPlan";

export function SubscriptionCheckoutView({
  email,
  publicKey,
  onBack,
  onSubscribe,
}: {
  email: string | null;
  publicKey: string;
  onBack: () => void;
  onSubscribe: (cardTokenId: string) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useState(() => {
    initMercadoPago(publicKey, {
      locale: "pt-BR",
      advancedFraudPrevention: true,
    });
    return publicKey;
  });

  return (
    <main className="public-shell">
      <section className="hero subscription-checkout">
        <p className="eyebrow">Pagamento seguro</p>
        <h1>Ative seus 7 dias grátis</h1>
        <p>
          O cartão será tokenizado pelo Mercado Pago. O aplicativo não recebe nem
          armazena o número ou o código de segurança.
        </p>
        <Card>
          {error && <Alert type="error">{error}</Alert>}
          {!ready && <p>Carregando checkout seguro…</p>}
          <CardPayment
            initialization={{
              amount: COMMERCIAL_PLAN.amount,
              payer: email ? { email } : undefined,
            }}
            customization={{
              paymentMethods: {
                maxInstallments: 1,
                types: { excluded: ["debit_card", "prepaid_card"] },
              },
              visual: { style: { theme: "default" } },
            }}
            locale="pt-BR"
            onReady={() => setReady(true)}
            onError={() =>
              setError("Não foi possível carregar o checkout do Mercado Pago.")
            }
            onSubmit={async ({ token }) => {
              setError("");
              try {
                await onSubscribe(token);
              } catch (cause) {
                setError((cause as Error).message);
                throw cause;
              }
            }}
          />
        </Card>
        <Button variant="ghost" onClick={onBack}>
          Voltar
        </Button>
      </section>
    </main>
  );
}
