# Gastos Simples

Aplicativo Web Premium para controle financeiro pessoal. O frontend usa Vite, React 19, TypeScript estrito, CSS e `@apps-simples/ui@0.4.1`. A autenticação usa Firebase Authentication; assinatura e entitlement usam Cloudflare Pages Functions, D1 e Mercado Pago; dados financeiros e perfis ficam somente no IndexedDB, isolados por Firebase UID.

Os nomes dos perfis integram o backup local. Os relatórios PDF são gerados e baixados exclusivamente no navegador, sem `fetch`, upload ou processamento no servidor. O PDF contém informações financeiras e deve ser armazenado com segurança.

## Desenvolvimento local

1. Copie `.env.example` para `.env.local` e preencha apenas a configuração pública do Firebase.
2. Crie `.dev.vars` (não versionado) com `FIREBASE_PROJECT_ID`, `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_PLAN_ID`, `MERCADO_PAGO_WEBHOOK_SECRET` quando aplicável e `APP_ORIGIN`. Opcionalmente, `ADMIN_FIREBASE_UIDS` aceita UIDs Firebase separados por vírgulas para acesso administrativo validado exclusivamente no backend.
3. Instale e valide com `npm install`, `npm test` e `npm run build`.
4. Para Functions + D1 local, instale/use Wrangler sem versionar credenciais e execute `npx wrangler pages dev dist --d1 DB=gastos-simples` após criar o banco local.

## Infraestrutura posterior

- Criar o banco D1 e substituir `database_id` no `wrangler.jsonc`.
- Aplicar `npx wrangler d1 migrations apply gastos-simples --remote`.
- Criar o plano real do Mercado Pago: BRL 1,99 por mês, teste grátis de 7 dias, duração ilimitada. Registrar o ID em `MERCADO_PAGO_PLAN_ID`.
- Cadastrar secrets/variáveis do Pages e configurar os domínios autorizados no Firebase.
- Criar o projeto Pages, associar o repositório futuro e validar webhook/checkout em ambiente de teste antes de produção.

Não há Firebase Hosting, Firestore, Storage, Admin SDK, PWA, service worker, manifest, Android ou Capacitor. O frontend não contém bypass de assinatura. O acesso administrativo não usa e-mail nem dados enviados pelo cliente: compara somente o UID do token Firebase já validado com `ADMIN_FIREBASE_UIDS` no backend.

Após aprovação funcional e visual, a política pública da Central de Privacidade deverá ser atualizada para documentar perfis locais, backup e geração local de PDF.

## Segurança do webhook

Quando `MERCADO_PAGO_WEBHOOK_SECRET` estiver disponível, `x-signature` e `x-request-id` são validados por HMAC com tolerância de cinco minutos. Se o fluxo de Assinaturas não disponibilizar esse segredo, a notificação não é tomada como verdade: o recurso é reconsultado pela API autenticada e somente persiste após validar conta, plano configurado, `external_reference`, versão do provedor, rate limit e idempotência.
