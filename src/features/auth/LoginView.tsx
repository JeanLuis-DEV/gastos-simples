import { Alert, Button, Card, Modal } from "@apps-simples/ui";
import { useState } from "react";

export function LoginView({
  onLogin,
  error,
  busy,
}: {
  onLogin: () => void;
  error?: string;
  busy: boolean;
}) {
  const [legalOpen, setLegalOpen] = useState(false);
  return (
    <main className="public-shell">
      <section className="hero" aria-labelledby="login-title">
        <p className="eyebrow">Controle financeiro pessoal</p>
        <h1 id="login-title">Gastos Simples</h1>
        <p>
          Seus dados financeiros ficam no seu navegador, separados e protegidos
          pela sua conta Google.
        </p>
        <Card>
          <h2>Entre para continuar</h2>
          <p>O acesso ao aplicativo é exclusivo para assinantes Premium.</p>
          {error && <Alert type="error">{error}</Alert>}
          <Button onClick={onLogin} disabled={busy}>
            {busy ? "Entrando…" : "Entrar com Google"}
          </Button>
        </Card>
        <p className="legal">
          Ao entrar, você concorda com{" "}
          <button className="link-button" onClick={() => setLegalOpen(true)}>
            Direito de uso
          </button>{" "}
          e a{" "}
          <a
            href="https://jeanluis-dev.github.io/Central-de-Privacidade/apps/gastos-simples.html"
            target="_blank"
            rel="noreferrer"
          >
            Política de privacidade
          </a>
          .
        </p>
        <Modal
          open={legalOpen}
          onClose={() => setLegalOpen(false)}
          title="Direito de uso"
          footer={<Button onClick={() => setLegalOpen(false)}>Fechar</Button>}
        >
          <p>
            A assinatura concede ao titular um direito pessoal, limitado,
            revogável e não transferível de usar o aplicativo. Não é permitido
            copiar, revender, explorar o serviço indevidamente ou contornar seus
            controles de acesso.
          </p>
        </Modal>
      </section>
    </main>
  );
}
