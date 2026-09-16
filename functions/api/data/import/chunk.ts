import { authenticate } from "../../../_shared/auth";
import { handle, HttpError, json } from "../../../_shared/http";
import { ensureSyncAccount, rateLimitSync, requirePublishedSyncPolicy, requirePushEntitlement, requireSyncCanaryAccess, requireSyncEnabled, syncEntitlement } from "../../../_shared/syncAccess";
import { appendImportChunk } from "../../../_shared/syncImport";
import { exactObject, opaqueId, readJsonBody } from "../../../_shared/syncHttp";
import { MAX_PUSH_BYTES, type SyncEntityType } from "../../../_shared/syncValidation";
import type { PagesContext } from "../../../types";

const entityTypes = new Set(["profile", "category", "series", "seriesSegment", "transaction", "calculator"]);
export async function onRequestPost(context: PagesContext) {
  return handle(context, async () => {
    requireSyncEnabled(context.env);
    requirePublishedSyncPolicy(context.env);
    const identity = await authenticate(context.request, context.env);
    requireSyncCanaryAccess(identity.uid, context.env);
    await rateLimitSync(context.env, context.request, identity.uid, "import-chunk", 30);
    await ensureSyncAccount(identity, context.env);
    requirePushEntitlement(await syncEntitlement(identity, context.env, true));
    const body = await readJsonBody(context.request, MAX_PUSH_BYTES);
    if (!exactObject(body, ["sessionId", "chunkIndex", "records"]) || !opaqueId(body.sessionId) || !Number.isSafeInteger(body.chunkIndex) || Number(body.chunkIndex) < 0 || !Array.isArray(body.records) || body.records.length < 1 || body.records.length > 100) throw new HttpError(400, "Bloco de importação inválido.");
    const records = body.records.map((item) => {
      if (!exactObject(item, ["entityType", "recordId", "payload"]) || !entityTypes.has(String(item.entityType)) || !opaqueId(item.recordId) || !item.payload || typeof item.payload !== "object" || Array.isArray(item.payload)) throw new HttpError(400, "Bloco de importação inválido.");
      return { entityType: item.entityType as SyncEntityType, recordId: String(item.recordId), payload: item.payload as Record<string, unknown> };
    });
    return json(context.env, await appendImportChunk(context.env, identity.uid, String(body.sessionId), Number(body.chunkIndex), records), 200, context.request);
  });
}
