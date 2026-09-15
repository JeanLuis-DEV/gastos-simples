import { authenticate } from "../_shared/auth";
import { handle, HttpError, json } from "../_shared/http";
import { ensureSyncAccount, rateLimitSync, requireRecentAuthentication } from "../_shared/syncAccess";
import { contentHash } from "../_shared/syncCrypto";
import { deleteFinancialData } from "../_shared/syncEngine";
import { exactObject, readJsonBody } from "../_shared/syncHttp";
import type { PagesContext } from "../types";

export async function onRequestDelete(context: PagesContext) {
  return handle(context, async () => {
    const identity = await authenticate(context.request, context.env);
    requireRecentAuthentication(identity);
    await rateLimitSync(context.env, context.request, identity.uid, "delete", 3);
    const account = await ensureSyncAccount(identity, context.env);
    const raw = await readJsonBody(context.request, 4 * 1024);
    if (!exactObject(raw, ["nonce"]) || typeof raw.nonce !== "string" || raw.nonce.length > 128) throw new HttpError(400, "Solicitação inválida.");
    const nonceHash = await contentHash(raw.nonce);
    const requestId = crypto.randomUUID();
    let nextEpoch: number;
    try {
      nextEpoch = await deleteFinancialData(context.env, identity.uid, requestId, account?.sync_epoch ?? 1, new Date(), { nonceHash });
    } catch {
      throw new HttpError(409, "A autorização de exclusão é inválida ou expirou.");
    }
    return json(context.env, {
      deleted: true,
      syncEpoch: nextEpoch,
      localDataDeleted: false,
      accountDeleted: false,
      subscriptionDeleted: false,
      providerBackupErasureNotGuaranteedImmediately: true,
    }, 200, context.request);
  });
}
