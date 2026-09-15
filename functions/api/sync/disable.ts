import { authenticate } from "../../_shared/auth";
import { handle, HttpError, json } from "../../_shared/http";
import { ensureSyncAccount, rateLimitSync } from "../../_shared/syncAccess";
import { exactObject, readJsonBody } from "../../_shared/syncHttp";
import type { PagesContext } from "../../types";

export async function onRequestPost(context: PagesContext) {
  return handle(context, async () => {
    const identity = await authenticate(context.request, context.env);
    await rateLimitSync(context.env, context.request, identity.uid, "disable", 5);
    await ensureSyncAccount(identity, context.env);
    const raw = await readJsonBody(context.request, 1024);
    if (!exactObject(raw, ["deleteRemoteData"]) || typeof raw.deleteRemoteData !== "boolean") throw new HttpError(400, "Solicitação inválida.");
    const now = new Date().toISOString();
    await context.env.DB.batch([
      context.env.DB.prepare("UPDATE sync_accounts SET disabled_at=?,updated_at=? WHERE firebase_uid=?").bind(now, now, identity.uid),
      context.env.DB.prepare("INSERT INTO sync_activations (firebase_uid,action,occurred_at) VALUES (?,?,?)").bind(identity.uid, raw.deleteRemoteData ? "disabled_delete_requested" : "disabled_keep", now),
    ]);
    return json(context.env, { enabled: false, deletionRequired: raw.deleteRemoteData }, 200, context.request);
  });
}
