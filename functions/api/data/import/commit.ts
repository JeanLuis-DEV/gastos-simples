import { authenticate } from "../../../_shared/auth";
import { handle, HttpError, json } from "../../../_shared/http";
import { ensureSyncAccount, rateLimitSync, requirePushEntitlement, requireSyncEnabled, syncEntitlement } from "../../../_shared/syncAccess";
import { commitImport } from "../../../_shared/syncImport";
import { exactObject, opaqueId, readJsonBody } from "../../../_shared/syncHttp";
import type { PagesContext } from "../../../types";

export async function onRequestPost(context: PagesContext) {
  return handle(context, async () => {
    requireSyncEnabled(context.env);
    const identity = await authenticate(context.request, context.env);
    await rateLimitSync(context.env, context.request, identity.uid, "import-commit", 5);
    await ensureSyncAccount(identity, context.env);
    requirePushEntitlement(await syncEntitlement(identity, context.env, true));
    const body = await readJsonBody(context.request, 4096);
    if (!exactObject(body, ["sessionId"]) || !opaqueId(body.sessionId)) throw new HttpError(400, "Solicitação de importação inválida.");
    return json(context.env, await commitImport(context.env, identity.uid, String(body.sessionId)), 200, context.request);
  });
}
