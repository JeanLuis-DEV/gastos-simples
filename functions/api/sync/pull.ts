import { authenticate } from "../../_shared/auth";
import { handle, json } from "../../_shared/http";
import { ensureSyncAccount, rateLimitSync, requireSyncEnabled, requireSyncEntitlement, syncEntitlement, updateRetention } from "../../_shared/syncAccess";
import { pullSync } from "../../_shared/syncEngine";
import { parsePullRequest } from "../../_shared/syncValidation";
import type { PagesContext } from "../../types";

export async function onRequestGet(context: PagesContext) {
  return handle(context, async () => {
    requireSyncEnabled(context.env);
    const identity = await authenticate(context.request, context.env);
    await rateLimitSync(context.env, context.request, identity.uid, "pull", 60);
    await ensureSyncAccount(identity, context.env);
    const entitlement = await syncEntitlement(identity, context.env);
    await updateRetention(context.env, identity.uid, entitlement);
    requireSyncEntitlement(entitlement);
    return json(context.env, await pullSync(context.env, identity.uid, parsePullRequest(context.request)), 200, context.request);
  });
}
