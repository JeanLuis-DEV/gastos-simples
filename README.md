# Gastos Simples

Aplicativo Web Premium para controle financeiro pessoal. O frontend usa Vite, React 19, TypeScript estrito, CSS e `@apps-simples/ui@0.4.1`. A autenticação usa Firebase Authentication; assinatura e entitlement usam Cloudflare Pages Functions, D1 e Mercado Pago. Os dados financeiros e perfis continuam somente no IndexedDB nesta fase; a fundação local de sincronização está protegida por kill switch e não possui transporte remoto.

URL oficial: https://gastos.centralsimples.com.br/

Os nomes dos perfis integram o backup local. Os relatórios PDF são gerados e baixados exclusivamente no navegador, sem `fetch`, upload ou processamento no servidor. O PDF contém informações financeiras e deve ser armazenado com segurança.

## Desenvolvimento local

1. Copie `.env.example` para `.env.local` e preencha apenas a configuração pública do Firebase.
2. Crie `.dev.vars` (não versionado) com `FIREBASE_PROJECT_ID`, `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_PUBLIC_KEY`, `MERCADO_PAGO_PLAN_ID`, `MERCADO_PAGO_WEBHOOK_SECRET` quando aplicável e `APP_ORIGIN`. Opcionalmente, `ADMIN_FIREBASE_UIDS` aceita UIDs Firebase separados por vírgulas para acesso administrativo validado exclusivamente no backend. Em sandbox, `MERCADO_PAGO_TEST_PAYER_EMAIL` pode definir um pagador sintético no formato oficial; nunca configure essa variável em produção.
3. Instale e valide com `npm install`, `npm test` e `npm run build`.
4. Para Functions + D1 local, instale/use Wrangler sem versionar credenciais e execute `npx wrangler pages dev dist --d1 DB=gastos-simples` após criar o banco local.

## Infraestrutura

- O D1 remoto `gastos-simples` usa as migrations versionadas deste repositório.
- O plano Gastos Simples Premium custa BRL 4,99 por mês, oferece sete dias grátis quando elegível e tem duração ilimitada.
- As variáveis e secrets do Pages são configurados fora do repositório. O frontend recebe somente a Public Key necessária ao Card Payment Brick; Access Token, plano e eventual segredo do webhook permanecem no backend.
- O cartão é tokenizado diretamente pelo Mercado Pago no Card Payment Brick. O aplicativo recebe apenas o token efêmero e o envia ao backend autenticado para criar a assinatura associada ao plano e ao UID Firebase.
- O webhook público de Assinaturas é `/api/webhooks/mercado-pago` e sempre reconsulta a assinatura pela API autenticada antes de atualizar o entitlement.
- O `APP_ORIGIN` de produção é `https://gastos.centralsimples.com.br`; o retorno do plano é `https://gastos.centralsimples.com.br/?assinatura=retorno` e o webhook oficial é `https://gastos.centralsimples.com.br/api/webhooks/mercado-pago`.
- Em produção, `VITE_FIREBASE_AUTH_DOMAIN` é `gastos.centralsimples.com.br`. O Cloudflare Pages encaminha transparentemente `/__/auth/*` ao helper fixo do projeto Firebase para que o login por redirecionamento funcione sem armazenamento de terceiros; não há redirecionamento HTTP nem Firebase Hosting.
- O host público legado `gastos-simples.pages.dev` redireciona permanentemente para o domínio oficial, preservando caminho e query; rotas `/api/*` e URLs de preview não são redirecionadas.

Não há Firebase Hosting, Firestore, Storage, Admin SDK, PWA, service worker, manifest, Android ou Capacitor. O frontend não contém bypass de assinatura. O acesso administrativo não usa e-mail nem dados enviados pelo cliente: compara somente o UID do token Firebase já validado com `ADMIN_FIREBASE_UIDS` no backend.

A arquitetura e as invariantes da fundação local de sincronização estão registradas em [`docs/sync-local-foundation.md`](docs/sync-local-foundation.md). `VITE_SYNC_ENABLED` deve permanecer `false` até a implementação e aprovação explícitas do backend, do consentimento e do rollout.

Após aprovação funcional e visual, a política pública da Central de Privacidade deverá ser atualizada para documentar perfis locais, backup e geração local de PDF.

## Segurança do webhook

Quando `MERCADO_PAGO_WEBHOOK_SECRET` estiver disponível, `x-signature` e `x-request-id` são validados por HMAC com tolerância de cinco minutos. Se o fluxo de Assinaturas não disponibilizar esse segredo, a notificação não é tomada como verdade: o recurso é reconsultado pela API autenticada e somente persiste após validar conta, plano configurado, `external_reference`, versão do provedor, rate limit e idempotência.
