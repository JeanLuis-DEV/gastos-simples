import { Card } from "@apps-simples/ui";
import { version } from "../../../package.json";
import { COMMERCIAL_PLAN_PRICE_LABEL } from "../../../shared/commercialPlan";
import { canUseRemoteSync } from "../../sync/config";
export function InstitutionalContent() {
  return (
    <Card>
      <h2>Informações</h2>
      <details>
        <summary>Sobre</summary>
        <p>
          Gastos Simples é um aplicativo Web para organização financeira
          pessoal. Os dados são isolados pela conta Google e permanecem disponíveis
          neste navegador.{canUseRemoteSync() ? " A sincronização entre dispositivos é opcional e só começa após consentimento expresso." : ""}
        </p>
      </details>
      <details id="direito-de-uso">
        <summary>Direito de uso</summary>
        <p>
          A assinatura concede ao titular um direito pessoal, limitado,
          revogável e não transferível de usar o aplicativo. Não é permitido
          copiar, revender, explorar o serviço indevidamente ou tentar contornar
          seus controles de acesso.
        </p>
      </details>
      <details>
        <summary>Privacidade</summary>
        <p>
          Relatórios PDF são gerados integralmente neste navegador. Nenhum dado
          financeiro ou PDF é enviado ao servidor. Como o arquivo baixado contém
          informações financeiras, armazene-o com segurança.
        </p>
        <p>
          Consulte a{" "}
          <a
            href="https://jeanluis-dev.github.io/Central-de-Privacidade/apps/gastos-simples.html"
            target="_blank"
            rel="noreferrer"
          >
            Política de Privacidade do Gastos Simples
          </a>
          .
        </p>
      </details>
      <details>
        <summary>Assinatura</summary>
        <p>
          Plano mensal de {COMMERCIAL_PLAN_PRICE_LABEL}, com sete dias grátis
          quando elegível, cobrado pelo Mercado Pago. O cancelamento interrompe
          futuras renovações conforme o estado confirmado pelo provedor.
        </p>
      </details>
      <p>Gastos Simples v{version}</p>
    </Card>
  );
}
