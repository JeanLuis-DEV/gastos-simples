# Fundação local de sincronização

Esta fase prepara o IndexedDB sem enviar dados para Firebase, Cloudflare, D1 ou qualquer endpoint. O kill switch `VITE_SYNC_ENABLED` nasce desligado e `canUseRemoteSync()` permanece bloqueado por código até a fase remota ser aprovada.

## Invariantes

- Toda alteração de lançamento, série, segmento, perfil, categoria ou histórico da calculadora grava o registro e a outbox na mesma transação IndexedDB.
- Exclusões geram tombstones; leituras normais os ocultam e leituras de sincronização podem incluí-los.
- `localVersion` é monotônica e não depende do relógio do dispositivo. `serverVersion`, `serverRevision`, cursor e epoch estão reservados para a resposta autoritativa do servidor.
- Uma `mutationId` repetida com o mesmo conteúdo é idempotente; com conteúdo diferente, é rejeitada.
- Dados são isolados por `ownerUid`; colisões de ID entre contas são rejeitadas antes da gravação.
- Séries recorrentes e parceladas possuem registros e segmentos explícitos. `occurrenceKey` é determinística e única por ocorrência.
- Preferências de tema, confirmação de exclusão e perfil selecionado permanecem locais ao dispositivo.
- O histórico local e o backup JSON continuam completos. A seleção destinada à sincronização limita a calculadora aos 100 registros mais recentes sem apagar os demais.

## Armazenamentos locais

`series`, `seriesSegments`, `syncOutbox`, `syncState`, `syncBaseSnapshots` e `syncConflicts` foram adicionados de forma não destrutiva na versão 3 do IndexedDB. A migração normaliza versões e chaves de ocorrência e deriva série/segmento dos lançamentos existentes.

O backup JSON usa schema 4 e inclui séries e segmentos, sem metadados internos de sincronização. Schemas 2 e 3 permanecem importáveis e são normalizados antes da transação atômica de merge ou substituição.

## Limite desta fase

Não existem push, pull, autenticação remota, D1, lease offline, interface de consentimento ou indicadores de sincronização nesta entrega. Esses fluxos só podem ser habilitados depois que o servidor autoritativo, as regras de entitlement, a política de privacidade e o rollout forem implementados e aprovados.
