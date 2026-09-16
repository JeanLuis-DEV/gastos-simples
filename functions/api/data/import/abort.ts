import { authenticate } from "../../../_shared/auth";
import { handle, HttpError, json } from "../../../_shared/http";
import { ensureSyncAccount, rateLimitSync } from "../../../_shared/syncAccess";
import { abortImport } from "../../../_shared/syncImport";
import { exactObject, opaqueId, readJsonBody } from "../../../_shared/syncHttp";
import type { PagesContext } from "../../../types";

export async function onRequestPost(context: PagesContext) {
  return handle(context, async () => {
    const identity = await authenticate(context.request, context.env);
    await rateLimitSync(context.env, context.request, identity.uid, "import-abort", 10);
    await ensureSyncAccount(identity, context.env);
    const body = await readJsonBody(context.request, 4096);
    if (!exactObject(body, ["sessionId"]) || !opaqueId(body.sessionId)) throw new HttpError(400, "Solicitação de importação inválida.");
    return json(context.env, await abortImport(context.env, identity.uid, String(body.sessionId)), 200, context.request);
  });
}
