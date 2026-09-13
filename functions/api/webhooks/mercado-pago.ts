import { handle, HttpError, json } from "../../_shared/http";
import {
  getSubscription,
  isOlderProviderUpdate,
  persistSubscription,
  providerTimestamp,
} from "../../_shared/mercadoPago";
import { rateLimit } from "../../_shared/rateLimit";
import type { PagesContext } from "../../types";
function safeEqual(a: string, b: string) {
  const aa = new TextEncoder().encode(a),
    bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i]! ^ bb[i]!;
  return diff === 0;
}
async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function validateWebhookSignature(
  request: Request,
  secret: string,
  resourceId: string,
  nowMs = Date.now(),
) {
  const signature = request.headers.get("x-signature") ?? "";
  const requestId = request.headers.get("x-request-id")?.trim() ?? "";
  const ts = signature.match(/(?:^|,)\s*ts=([^,]+)/)?.[1]?.trim();
  const v1 = signature
    .match(/(?:^|,)\s*v1=([^,]+)/)?.[1]
    ?.trim()
    .toLowerCase();
  const numericTs = Number(ts);
  const tsMs = numericTs > 1e12 ? numericTs : numericTs * 1000;
  if (
    !requestId ||
    !ts ||
    !v1 ||
    !Number.isFinite(tsMs) ||
    Math.abs(nowMs - tsMs) > 300_000
  )
    throw new HttpError(401, "Webhook inválido.");
  const expected = await hmac(
    secret,
    `id:${resourceId.toLowerCase()};request-id:${requestId};ts:${ts};`,
  );
  if (!safeEqual(expected, v1)) throw new HttpError(401, "Webhook inválido.");
}
export async function webhookEventKey(
  type: string,
  resourceId: string,
  providerVersion: string,
) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${type}:${resourceId}:${providerVersion}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function reconcileWebhook(actions: {
  exists: () => Promise<boolean>;
  isOlder?: () => Promise<boolean>;
  persist: () => Promise<void>;
  record: (result: "processed" | "stale") => Promise<void>;
}) {
  if (await actions.exists()) return "duplicate";
  if (await actions.isOlder?.()) {
    await actions.record("stale");
    return "stale";
  }
  await actions.persist();
  await actions.record("processed");
  return "processed";
}
export async function onRequestPost(context: PagesContext) {
  return handle(context, async () => {
    const url = new URL(context.request.url);
    const body = (await context.request.json().catch(() => null)) as {
      type?: string;
      action?: string;
      data?: { id?: string | number };
    } | null;
    const queryResourceId = url.searchParams.get("data.id")?.trim() ?? "";
    const resourceId = String(queryResourceId || body?.data?.id || "").trim();
    const type = url.searchParams.get("type") ?? body?.type ?? "";
    if (!resourceId || type !== "subscription_preapproval")
      throw new HttpError(400, "Evento não suportado.");
    if (context.env.MERCADO_PAGO_WEBHOOK_SECRET) {
      if (!queryResourceId || queryResourceId !== resourceId)
        throw new HttpError(401, "Webhook inválido.");
      await validateWebhookSignature(
        context.request,
        context.env.MERCADO_PAGO_WEBHOOK_SECRET,
        queryResourceId,
      );
    }
    const subscription = await getSubscription(context.env, resourceId);
    if (!subscription.external_reference)
      throw new HttpError(400, "Assinatura sem vínculo de usuário.");
    const user = await context.env.DB.prepare(
      "SELECT firebase_uid FROM users WHERE firebase_uid=?",
    )
      .bind(subscription.external_reference)
      .first();
    if (!user)
      throw new HttpError(400, "Usuário da assinatura não encontrado.");
    const providerVersion = providerTimestamp(subscription);
    const eventId = await webhookEventKey(type, resourceId, providerVersion);
    await reconcileWebhook({
      exists: async () =>
        Boolean(
          await context.env.DB.prepare(
            "SELECT event_id FROM webhook_events WHERE event_id=?",
          )
            .bind(eventId)
            .first(),
        ),
      isOlder: async () => {
        await rateLimit(context.env, `webhook:${resourceId}`, 30, 300);
        const stored = await context.env.DB.prepare(
          "SELECT provider_updated_at FROM subscriptions WHERE firebase_uid=?",
        )
          .bind(subscription.external_reference!)
          .first<{ provider_updated_at: string | null }>();
        return isOlderProviderUpdate(
          providerVersion,
          stored?.provider_updated_at,
        );
      },
      persist: async () => {
        await persistSubscription(
          context.env,
          subscription.external_reference!,
          subscription,
        );
      },
      record: async (result) => {
        await context.env.DB.prepare(
          "INSERT OR IGNORE INTO webhook_events (event_id,type,resource_id,processed_at,result) VALUES (?,?,?,?,?)",
        )
          .bind(
            eventId,
            type,
            resourceId,
            new Date().toISOString(),
            result,
          )
          .run();
      },
    });
    return json(context.env, { ok: true }, 200, context.request);
  });
}
