# Worker de manutenção da sincronização

Worker agendado separado das Pages Functions. O único binding de dados permitido é `SYNC_DB`, apontando futuramente para o D1 exclusivo de sincronização do ambiente correspondente.

Validação local do bundle:

```powershell
node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config workers/sync-maintenance/wrangler.example.jsonc
```

O arquivo de exemplo usa ID nulo, compactação desligada e não contém secrets. Não execute deploy antes da autorização e do provisionamento formal do ambiente de homologação.
