import { authenticate } from "../../_shared/auth";
import { handle, HttpError, json } from "../../_shared/http";
import { ensureSyncAccount, rateLimitSync, requirePublishedSyncPolicy, requirePushEntitlement, requireSyncCanaryAccess, requireSyncEnabled, syncEntitlement } from "../../_shared/syncAccess";
import { exactObject, opaqueId, readJsonBody } from "../../_shared/syncHttp";
import type { PagesContext } from "../../types";
import { SYNC_PRIVACY_POLICY_LABEL, SYNC_PRIVACY_POLICY_VERSION } from "../../../shared/syncPolicy";

export async function onRequestPost(context: PagesContext) {
  return handle(context, async () => {
    requireSyncEnabled(context.env);
    requirePublishedSyncPolicy(context.env);
    const identity = await authenticate(context.request, context.env);
    requireSyncCanaryAccess(identity.uid, context.env);
    await rateLimitSync(context.env, context.request, identity.uid, "activate", 5);
    const raw = await readJsonBody(context.request, 4 * 1024);
    if (!exactObject(raw, ["protocolVersion", "deviceId", "consentVersion"]) || raw.protocolVersion !== 1 || raw.consentVersion !== SYNC_PRIVACY_POLICY_VERSION || !opaqueId(raw.deviceId))
      throw new HttpError(400, "Solicitação de ativação inválida.");
    const account = await ensureSyncAccount(identity, context.env);
    const entitlement = await syncEntitlement(identity, context.env, true);
    requirePushEntitlement(entitlement);
    const now = new Date().toISOString();
    const action = account?.activated_at ? "reactivated" : "activated";
    await context.env.DB.batch([
      context.env.DB.prepare("UPDATE sync_accounts SET activated_at=COALESCE(activated_at,?),disabled_at=NULL,consent_version=?,consent_accepted_at=?,updated_at=? WHERE firebase_uid=?").bind(now, SYNC_PRIVACY_POLICY_VERSION, now, now, identity.uid),
      context.env.DB.prepare("INSERT INTO sync_activations (firebase_uid,action,occurred_at,consent_version,policy_version) VALUES (?,?,?,?,?)").bind(identity.uid, action, now, SYNC_PRIVACY_POLICY_VERSION, SYNC_PRIVACY_POLICY_LABEL),
      context.env.DB.prepare("INSERT INTO sync_devices (firebase_uid,device_id,protocol_version,created_at,last_seen_at) VALUES (?,?,?,?,?) ON CONFLICT(firebase_uid,device_id) DO UPDATE SET protocol_version=excluded.protocol_version,last_seen_at=excluded.last_seen_at").bind(identity.uid, raw.deviceId, 1, now, now),
      context.env.DB.prepare("INSERT INTO sync_retention (firebase_uid,entitlement_status,became_ineligible_at,purge_after,reactivated_at,updated_at) VALUES (?,?,NULL,NULL,?,?) ON CONFLICT(firebase_uid) DO UPDATE SET entitlement_status=excluded.entitlement_status,became_ineligible_at=NULL,purge_after=NULL,reactivated_at=excluded.reactivated_at,updated_at=excluded.updated_at").bind(identity.uid, entitlement, now, now),
    ]);
    return json(context.env, { enabled: true, syncEpoch: account?.sync_epoch ?? 1, highWatermark: account?.revision ?? 0, consentAcceptedAt: now }, 200, context.request);
  });
}
