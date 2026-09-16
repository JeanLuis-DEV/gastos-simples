export const SYNC_FEATURE_ENABLED =
  import.meta.env.VITE_SYNC_ENABLED === "true";

export const SYNC_PROTOCOL_VERSION = 1 as const;

export function canUseRemoteSync() {
  return SYNC_FEATURE_ENABLED;
}
