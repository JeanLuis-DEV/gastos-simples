# Runbook de homologação e canário da sincronização

Este documento prepara comandos; não autoriza executá-los contra recursos remotos. Substitua todos os valores entre `<...>` e confira a conta Cloudflare antes de qualquer operação.

## Invariantes

- D1, projeto Pages e Firebase de homologação devem ser separados da produção.
- `VITE_SYNC_ENABLED=false` e `SYNC_ENABLED=false` permanecem assim até as etapas indicadas.
- `SYNC_CANARY_ADMIN_ONLY=true` restringe ativação, push e importação aos UIDs presentes no secret `ADMIN_FIREBASE_UIDS`.
- `ADMIN_FIREBASE_UIDS`, `SYNC_ENCRYPTION_KEYS` e credenciais do Mercado Pago são secrets; nenhum UID ou valor real entra no Git, comandos salvos, logs ou relatórios.
- `SYNC_ACTIVE_KEY_ID` é configuração não secreta. O mapa secreto deve conter a chave ativa e a anterior durante uma rotação.

## Preparação futura com placeholders

```powershell
# Criar somente após autorização explícita.
npx wrangler d1 create <STAGING_D1_NAME>
Copy-Item config/wrangler.staging.example.jsonc config/wrangler.staging.jsonc
# Preencher exclusivamente o ID retornado e os hosts de homologação.
npx wrangler d1 migrations list <STAGING_D1_NAME> --remote --config config/wrangler.staging.jsonc
npx wrangler d1 migrations apply <STAGING_D1_NAME> --remote --config config/wrangler.staging.jsonc

# Secrets do projeto Pages de homologação; inserir pelo prompt, nunca na linha de comando.
npx wrangler pages secret put ADMIN_FIREBASE_UIDS --project-name <STAGING_PAGES_PROJECT>
npx wrangler pages secret put SYNC_ENCRYPTION_KEYS --project-name <STAGING_PAGES_PROJECT>
```

No Firebase de homologação, autorize somente `localhost`, o domínio exato do preview/canário e o domínio auxiliar de autenticação realmente usado. Não autorize curingas. O projeto Pages deve ser independente do projeto produtivo e vincular apenas o D1 de homologação.

## Ordem de ativação

1. Confirmar publicação e revisão jurídica da política `2026.09.15-sync.1`.
2. Aplicar as migrations no D1 de homologação e executar as consultas de integridade.
3. Configurar chaves AES-GCM reais como secret; manter `staging-v1` e a chave anterior no mapa durante rotação.
4. Publicar o backend de homologação ainda com `SYNC_ENABLED=false`.
5. Definir `SYNC_POLICY_VERSION=2026.09.15-sync.1`, `SYNC_CANARY_ADMIN_ONLY=true` e então `SYNC_ENABLED=true` somente na homologação.
6. Validar status, autenticação, IDOR, limites, pull, exportação e exclusão com o frontend ainda desligado.
7. Gerar o frontend de homologação com `VITE_SYNC_ENABLED=true`, mantendo o canário restrito ao UID administrativo pelo backend.
8. Ler a política, marcar a caixa de consentimento e confirmar que versão e horário do servidor foram registrados.
9. Executar o primeiro bootstrap controlado, comparar contagens e testar computador/celular simultaneamente.
10. Manter `COMPACTION_ENABLED=false` até validar full resync real; somente depois considerar o Worker agendado.

## Rollback

1. Republicar o frontend com `VITE_SYNC_ENABLED=false`.
2. Definir `SYNC_ENABLED=false` no backend para interromper ativação, push, pull e imports; exportação e exclusão continuam acessíveis.
3. Preservar IndexedDB, outbox, D1 e chaves. Não reverter migrations nem apagar tabelas.
4. Exportar uma cópia controlada da conta administrativa e registrar apenas contagens e revisões.
5. Verificar `syncEpoch`, `revision`, `minAvailableRevision`, cursores e lotes pendentes antes de retomar.
6. Corrigir e validar localmente; reativar primeiro o backend e depois o frontend.

Time Travel pode auxiliar investigação ou recuperação excepcional, mas não substitui exportação, migrations aditivas e rollback por flags.

## Rotação emergencial de chave

1. Gerar uma nova chave AES-256 fora do repositório e incluí-la no secret `SYNC_ENCRYPTION_KEYS` junto da chave anterior.
2. Alterar `SYNC_ACTIVE_KEY_ID` para o novo ID e validar leitura de registros antigos pelo `key_id` persistido.
3. Novas gravações usam a chave ativa; dados antigos continuam legíveis pela chave anterior.
4. Recriptografar em lotes controlados, com métricas por contagem e sem payloads em logs.
5. Remover a chave anterior somente quando não existir nenhum registro, snapshot, conflito ou staging referenciando seu ID.
