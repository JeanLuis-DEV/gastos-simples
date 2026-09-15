import { authenticate } from "../../_shared/auth";
import { handle, json } from "../../_shared/http";
import { ensureSyncAccount, rateLimitSync, requirePushEntitlement, requireSyncEnabled, syncEntitlement, updateRetention } from "../../_shared/syncAccess";
import { pushSync } from "../../_shared/syncEngine";
import { readJsonBody } from "../../_shared/syncHttp";
import { MAX_PUSH_BYTES, parsePushRequest } from "../../_shared/syncValidation";
import type { PagesContext } from "../../types";

export async function onRequestPost(context: PagesContext) {
  return handle(context, async () => {
    requireSyncEnabled(context.env);
    const identity = await authenticate(context.request, context.env);
    await rateLimitSync(context.env, context.request, identity.uid, "push", 30);
    await ensureSyncAccount(identity, context.env);
    const entitlement = await syncEntitlement(identity, context.env, true);
    requirePushEntitlement(entitlement);
    await updateRetention(context.env, identity.uid, entitlement);
    const body = parsePushRequest(context.request, await readJsonBody(context.request, MAX_PUSH_BYTES));
    return json(context.env, await pushSync(context.env, identity, body), 200, context.request);
  });
}
