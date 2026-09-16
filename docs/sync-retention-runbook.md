# Retenção e manutenção da sincronização

Esta política técnica acompanha a versão de privacidade `2026.09.15-sync.1`. Ela não substitui revisão jurídica e não autoriza deploy.

## Janelas

- Dados financeiros de contas canceladas ou expiradas: 90 dias a partir de `became_ineligible_at`. A reativação limpa `purge_after` antes da execução.
- Sessões de importação abertas ou abortadas: 24 horas, conforme `expires_at` gravado pelo servidor.
- Nonces de exclusão: removidos depois de `expires_at`.
- Tombstones, histórico incremental, recibos idempotentes, lotes, dispositivos inativos e conflitos resolvidos: 180 dias. Essa janela técnica é maior que o lease offline de 7 dias e precisa de aprovação final antes de habilitar `COMPACTION_ENABLED`.
- `users`, `subscriptions`, `webhook_events` e registros de pagamento não são removidos pelo Worker de manutenção.

## Segurança da compactação

O Worker mantém a alteração mais recente de cada registro ativo, remove tombstones antigos e avança `sync_accounts.min_available_revision`. Um dispositivo com cursor anterior recebe `resync_required`; o cliente remove apenas cópias remotas limpas, preserva a outbox e reinicia do cursor zero. A exclusão financeira por retenção incrementa `syncEpoch` e zera revisão e cursor remoto, impedindo que um dispositivo antigo reenvie silenciosamente o snapshot anterior.

Cada conta é processada em um `D1 batch` com guarda otimista de epoch/revisão. Uma falha reverte somente a conta afetada e não interrompe as demais. As execuções são idempotentes por `request_id`.

## Logs e métricas

O Worker registra somente `requestId`, duração, código e contagens agregadas. UID, descrições, valores, observações, payloads, e-mails e identificadores financeiros não podem ser enviados aos logs.

## Configuração inicial

`COMPACTION_ENABLED` deve permanecer `false` no primeiro canário. Habilite somente depois do teste real de full resync em computador e celular e da aprovação da janela técnica de 180 dias.
