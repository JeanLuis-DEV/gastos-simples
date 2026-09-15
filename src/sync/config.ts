export const SYNC_FEATURE_ENABLED =
  import.meta.env.VITE_SYNC_ENABLED === "true";

export const SYNC_PROTOCOL_VERSION = 1 as const;

// A Fase 1 não contém transporte remoto. O flag existe como kill switch local.
export function canUseRemoteSync() {
  return SYNC_FEATURE_ENABLED && false;
}
