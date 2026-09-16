import { SYNC_PRIVACY_POLICY_URL as DEFAULT_SYNC_PRIVACY_POLICY_URL } from "../../shared/syncPolicy";

export const SYNC_FEATURE_ENABLED =
  import.meta.env.VITE_SYNC_ENABLED === "true";

export const SYNC_PROTOCOL_VERSION = 1 as const;

export function resolveSyncPrivacyPolicyUrl(value?: string) {
  if (!value?.trim()) return DEFAULT_SYNC_PRIVACY_POLICY_URL;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" ? parsed.toString() : DEFAULT_SYNC_PRIVACY_POLICY_URL;
  } catch {
    return DEFAULT_SYNC_PRIVACY_POLICY_URL;
  }
}

export const SYNC_PRIVACY_POLICY_URL = resolveSyncPrivacyPolicyUrl(
  import.meta.env.VITE_SYNC_PRIVACY_POLICY_URL,
);

export function canUseRemoteSync() {
  return SYNC_FEATURE_ENABLED;
}
