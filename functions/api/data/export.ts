import { authenticate } from "../../_shared/auth";
import { handle, json } from "../../_shared/http";
import { ensureSyncAccount, rateLimitSync } from "../../_shared/syncAccess";
import { exportRemoteData } from "../../_shared/syncEngine";
import type { PagesContext } from "../../types";

export async function onRequestGet(context: PagesContext) {
  return handle(context, async () => {
    const identity = await authenticate(context.request, context.env);
    await rateLimitSync(context.env, context.request, identity.uid, "export", 10);
    await ensureSyncAccount(identity, context.env);
    return json(context.env, await exportRemoteData(context.env, identity.uid), 200, context.request);
  });
}
