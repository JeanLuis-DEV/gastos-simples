import { authenticate } from "../../_shared/auth";
import { handle, json } from "../../_shared/http";
import { ensureSyncAccount, rateLimitSync, syncEntitlement, updateRetention } from "../../_shared/syncAccess";
import type { PagesContext } from "../../types";

export async function onRequestGet(context: PagesContext) {
  return handle(context, async () => {
    const identity = await authenticate(context.request, context.env);
    await rateLimitSync(context.env, context.request, identity.uid, "status", 60);
    const account = await ensureSyncAccount(identity, context.env);
    const entitlement = await syncEntitlement(identity, context.env);
    await updateRetention(context.env, identity.uid, entitlement);
    return json(context.env, {
      protocolVersion: 1,
      available: context.env.SYNC_ENABLED === "true",
      enabled: Boolean(account?.activated_at && !account.disabled_at),
      syncEpoch: account?.sync_epoch ?? 1,
      highWatermark: account?.revision ?? 0,
      canPush: ["trial", "active", "admin"].includes(entitlement),
      canPull: Boolean(account?.activated_at && !account.disabled_at),
      canExport: true,
      canDelete: true,
      serverTime: new Date().toISOString(),
    }, 200, context.request);
  });
}
