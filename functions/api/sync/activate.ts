import { authenticate } from "../../_shared/auth";
import { handle, HttpError, json } from "../../_shared/http";
import { ensureSyncAccount, rateLimitSync, requirePushEntitlement, requireSyncEnabled, syncEntitlement, updateRetention } from "../../_shared/syncAccess";
import { exactObject, opaqueId, readJsonBody } from "../../_shared/syncHttp";
import type { PagesContext } from "../../types";

export async function onRequestPost(context: PagesContext) {
  return handle(context, async () => {
    requireSyncEnabled(context.env);
    const identity = await authenticate(context.request, context.env);
    await rateLimitSync(context.env, context.request, identity.uid, "activate", 5);
    const raw = await readJsonBody(context.request, 4 * 1024);
    if (!exactObject(raw, ["protocolVersion", "deviceId", "consentVersion"]) || raw.protocolVersion !== 1 || raw.consentVersion !== 1 || !opaqueId(raw.deviceId))
      throw new HttpError(400, "Solicitação de ativação inválida.");
    const account = await ensureSyncAccount(identity, context.env);
    const entitlement = await syncEntitlement(identity, context.env, true);
    requirePushEntitlement(entitlement);
    const now = new Date().toISOString();
    const action = account?.activated_at ? "reactivated" : "activated";
    await context.env.DB.batch([
      context.env.DB.prepare("UPDATE sync_accounts SET activated_at=COALESCE(activated_at,?),disabled_at=NULL,updated_at=? WHERE firebase_uid=?").bind(now, now, identity.uid),
      context.env.DB.prepare("INSERT INTO sync_activations (firebase_uid,action,occurred_at) VALUES (?,?,?)").bind(identity.uid, action, now),
      context.env.DB.prepare("INSERT INTO sync_devices (firebase_uid,device_id,protocol_version,created_at,last_seen_at) VALUES (?,?,?,?,?) ON CONFLICT(firebase_uid,device_id) DO UPDATE SET protocol_version=excluded.protocol_version,last_seen_at=excluded.last_seen_at").bind(identity.uid, raw.deviceId, 1, now, now),
    ]);
    await updateRetention(context.env, identity.uid, entitlement);
    return json(context.env, { enabled: true, syncEpoch: account?.sync_epoch ?? 1, highWatermark: account?.revision ?? 0 }, 200, context.request);
  });
}
