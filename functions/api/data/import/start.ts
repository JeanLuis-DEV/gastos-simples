import { authenticate } from "../../../_shared/auth";
import { handle, HttpError, json } from "../../../_shared/http";
import { ensureSyncAccount, rateLimitSync, requirePublishedSyncPolicy, requirePushEntitlement, requireSyncCanaryAccess, requireSyncEnabled, syncEntitlement } from "../../../_shared/syncAccess";
import { startImport } from "../../../_shared/syncImport";
import { exactObject, readJsonBody } from "../../../_shared/syncHttp";
import type { PagesContext } from "../../../types";

export async function onRequestPost(context: PagesContext) {
  return handle(context, async () => {
    requireSyncEnabled(context.env);
    requirePublishedSyncPolicy(context.env);
    const identity = await authenticate(context.request, context.env);
    requireSyncCanaryAccess(identity.uid, context.env);
    await rateLimitSync(context.env, context.request, identity.uid, "import-start", 5);
    await ensureSyncAccount(identity, context.env);
    requirePushEntitlement(await syncEntitlement(identity, context.env, true));
    const body = await readJsonBody(context.request, 4096);
    if (!exactObject(body, ["mode", "baseRevision"]) || !["merge", "replace"].includes(String(body.mode)) || !Number.isSafeInteger(body.baseRevision) || Number(body.baseRevision) < 0) throw new HttpError(400, "Solicitação de importação inválida.");
    return json(context.env, await startImport(context.env, identity.uid, body.mode as "merge" | "replace", Number(body.baseRevision)), 200, context.request);
  });
}
