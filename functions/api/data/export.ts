import { authenticate } from "../../_shared/auth";
import { handle, json } from "../../_shared/http";
import { ensureSyncAccount, rateLimitSync } from "../../_shared/syncAccess";
import { exportRemoteData } from "../../_shared/syncEngine";
import type { PagesContext } from "../../types";
import { HttpError } from "../../_shared/http";

export async function onRequestGet(context: PagesContext) {
  return handle(context, async () => {
    const identity = await authenticate(context.request, context.env);
    await rateLimitSync(context.env, context.request, identity.uid, "export", 10);
    await ensureSyncAccount(identity, context.env);
    const url = new URL(context.request.url);
    const allowed = new Set(["cursor", "untilRevision", "limit"]);
    if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) throw new HttpError(400, "Parâmetros inválidos.");
    const cursor = Number(url.searchParams.get("cursor") ?? 0);
    const untilValue = url.searchParams.get("untilRevision");
    const untilRevision = untilValue === null ? undefined : Number(untilValue);
    const limit = Number(url.searchParams.get("limit") ?? 200);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || (untilRevision !== undefined && (!Number.isSafeInteger(untilRevision) || untilRevision < 0)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new HttpError(400, "Parâmetros inválidos.");
    return json(context.env, await exportRemoteData(context.env, identity.uid, { cursor, untilRevision, limit }), 200, context.request);
  });
}
