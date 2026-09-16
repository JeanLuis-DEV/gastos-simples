import { hasAdministrativeAccess } from "./admin";
import { registerUser } from "./auth";
import { HttpError } from "./http";
import { getSubscription, persistSubscription } from "./mercadoPago";
import type { AuthIdentity, Env } from "../types";
import { contentHash } from "./syncCrypto";
import { rateLimit } from "./rateLimit";
import { SYNC_PRIVACY_POLICY_LABEL } from "../../shared/syncPolicy";

export type SyncEntitlement = "admin" | "trial" | "active" | "paused" | "cancelled" | "expired" | "none" | "other";

export function requireSyncEnabled(env: Env) {
  if (env.SYNC_ENABLED !== "true") throw new HttpError(503, "Sincronização indisponível.");
}

export function isSyncPolicyPublished(env: Env) {
  return env.SYNC_POLICY_VERSION === SYNC_PRIVACY_POLICY_LABEL;
}

export function requirePublishedSyncPolicy(env: Env) {
  if (!isSyncPolicyPublished(env)) throw new HttpError(503, "Sincronização indisponível.");
}

export function isSyncCanaryAllowed(ownerUid: string, env: Env) {
  return env.SYNC_CANARY_ADMIN_ONLY !== "true" || hasAdministrativeAccess(ownerUid, env.ADMIN_FIREBASE_UIDS);
}

export function requireSyncCanaryAccess(ownerUid: string, env: Env) {
  if (!isSyncCanaryAllowed(ownerUid, env)) throw new HttpError(403, "Sincronização indisponível para esta conta.");
}

export async function syncEntitlement(identity: AuthIdentity, env: Env, refreshProvider = false): Promise<SyncEntitlement> {
  if (hasAdministrativeAccess(identity.uid, env.ADMIN_FIREBASE_UIDS)) return "admin";
  const stored = await env.DB.prepare("SELECT mp_subscription_id,status_normalized,end_at FROM subscriptions WHERE firebase_uid=?")
    .bind(identity.uid)
    .first<{ mp_subscription_id: string | null; status_normalized: string; end_at: string | null }>();
  if (!stored) return "none";
  if (refreshProvider && stored.mp_subscription_id) {
    const subscription = await getSubscription(env, stored.mp_subscription_id);
    return await persistSubscription(env, identity.uid, subscription) as SyncEntitlement;
  }
  if (stored.end_at && Date.parse(stored.end_at) <= Date.now()) return "expired";
  const status = stored.status_normalized.toLowerCase();
  if (["trial", "active", "paused", "cancelled"].includes(status)) return status as SyncEntitlement;
  if (status === "authorized") return "active";
  return "other";
}

export function requirePushEntitlement(status: SyncEntitlement) {
  if (!["trial", "active", "admin"].includes(status))
    throw new HttpError(403, "Sua assinatura não permite enviar alterações.");
}

export async function ensureSyncAccount(identity: AuthIdentity, env: Env) {
  await registerUser(identity, env);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO sync_accounts (firebase_uid,sync_epoch,revision,created_at,updated_at) VALUES (?,1,0,?,?) ON CONFLICT(firebase_uid) DO NOTHING",
  ).bind(identity.uid, now, now).run();
  return env.DB.prepare("SELECT sync_epoch,revision,min_available_revision,activated_at,disabled_at FROM sync_accounts WHERE firebase_uid=?")
    .bind(identity.uid)
    .first<{ sync_epoch: number; revision: number; min_available_revision: number; activated_at: string | null; disabled_at: string | null }>();
}

export async function hasRemoteFinancialData(env: Env, ownerUid: string) {
  const result = await env.DB.prepare(`SELECT (
    EXISTS(SELECT 1 FROM sync_profiles WHERE firebase_uid=? AND is_deleted=0) OR
    EXISTS(SELECT 1 FROM sync_categories WHERE firebase_uid=? AND is_deleted=0) OR
    EXISTS(SELECT 1 FROM sync_series WHERE firebase_uid=? AND is_deleted=0) OR
    EXISTS(SELECT 1 FROM sync_series_segments WHERE firebase_uid=? AND is_deleted=0) OR
    EXISTS(SELECT 1 FROM sync_transactions WHERE firebase_uid=? AND is_deleted=0) OR
    EXISTS(SELECT 1 FROM sync_calculator_entries WHERE firebase_uid=? AND is_deleted=0)
  ) AS has_data`)
    .bind(ownerUid, ownerUid, ownerUid, ownerUid, ownerUid, ownerUid)
    .first<{ has_data: number }>();
  return result?.has_data === 1;
}

export async function updateRetention(env: Env, ownerUid: string, status: SyncEntitlement) {
  const now = new Date();
  const eligible = ["trial", "active", "admin"].includes(status);
  if (eligible) {
    await env.DB.prepare(
      "INSERT INTO sync_retention (firebase_uid,entitlement_status,became_ineligible_at,purge_after,reactivated_at,updated_at) VALUES (?,?,NULL,NULL,?,?) ON CONFLICT(firebase_uid) DO UPDATE SET entitlement_status=excluded.entitlement_status,became_ineligible_at=NULL,purge_after=NULL,reactivated_at=excluded.reactivated_at,updated_at=excluded.updated_at",
    ).bind(ownerUid, status, now.toISOString(), now.toISOString()).run();
    return;
  }
  const purgeAfter = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO sync_retention (firebase_uid,entitlement_status,became_ineligible_at,purge_after,reactivated_at,updated_at) VALUES (?,?,?,?,NULL,?) ON CONFLICT(firebase_uid) DO UPDATE SET entitlement_status=excluded.entitlement_status,became_ineligible_at=COALESCE(sync_retention.became_ineligible_at,excluded.became_ineligible_at),purge_after=COALESCE(sync_retention.purge_after,excluded.purge_after),updated_at=excluded.updated_at",
  ).bind(ownerUid, status, now.toISOString(), purgeAfter, now.toISOString()).run();
}

export function requireRecentAuthentication(identity: AuthIdentity, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!identity.authTime || identity.authTime > nowSeconds || nowSeconds - identity.authTime > 5 * 60)
    throw new HttpError(401, "Confirme novamente sua identidade para continuar.");
}

export async function rateLimitSync(env: Env, request: Request, ownerUid: string, action: string, limit: number, windowSeconds = 60) {
  const uidKey = await contentHash(`uid:${ownerUid}`);
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const ipKey = await contentHash(`ip:${ip}`);
  await rateLimit(env, `sync:${action}:uid:${uidKey}`, limit, windowSeconds);
  await rateLimit(env, `sync:${action}:ip:${ipKey}`, Math.max(limit * 3, limit + 10), windowSeconds);
}
