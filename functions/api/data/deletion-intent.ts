import { authenticate } from "../../_shared/auth";
import { handle, json } from "../../_shared/http";
import { ensureSyncAccount, rateLimitSync, requireRecentAuthentication } from "../../_shared/syncAccess";
import { contentHash } from "../../_shared/syncCrypto";
import { randomToken } from "../../_shared/syncHttp";
import type { PagesContext } from "../../types";

export async function onRequestPost(context: PagesContext) {
  return handle(context, async () => {
    const identity = await authenticate(context.request, context.env);
    requireRecentAuthentication(identity);
    await rateLimitSync(context.env, context.request, identity.uid, "deletion-intent", 3);
    await ensureSyncAccount(identity, context.env);
    const nonce = randomToken();
    const nonceHash = await contentHash(nonce);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    await context.env.DB.prepare("INSERT INTO sync_deletion_nonces (firebase_uid,nonce_hash,issued_at,expires_at,auth_time) VALUES (?,?,?,?,?)")
      .bind(identity.uid, nonceHash, now.toISOString(), expiresAt.toISOString(), identity.authTime).run();
    return json(context.env, { nonce, expiresAt: expiresAt.toISOString() }, 200, context.request);
  });
}
