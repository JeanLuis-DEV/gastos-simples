import { authenticate } from "../../_shared/auth";
import { handle, HttpError, json } from "../../_shared/http";
import {
  getSubscription,
  mpRequest,
  persistSubscription,
  validateSubscription,
  type MercadoSubscription,
} from "../../_shared/mercadoPago";
import { rateLimit } from "../../_shared/rateLimit";
import type { PagesContext } from "../../types";
export async function onRequestPost(context: PagesContext) {
  return handle(context, async () => {
    const identity = await authenticate(context.request, context.env);
    await rateLimit(context.env, `subscription:cancel:${identity.uid}`, 3, 300);
    const stored = await context.env.DB.prepare(
      "SELECT mp_subscription_id FROM subscriptions WHERE firebase_uid=?",
    )
      .bind(identity.uid)
      .first<{ mp_subscription_id: string | null }>();
    if (!stored?.mp_subscription_id)
      throw new HttpError(404, "Assinatura não encontrada.");
    const current = await getSubscription(
      context.env,
      stored.mp_subscription_id,
    );
    await validateSubscription(context.env, identity.uid, current);
    if (!["authorized", "paused"].includes(current.status))
      throw new HttpError(
        409,
        "Esta assinatura não pode ser cancelada no estado atual.",
      );
    const cancelled = await mpRequest<MercadoSubscription>(
      context.env,
      `/preapproval/${encodeURIComponent(current.id)}`,
      { method: "PUT", body: JSON.stringify({ status: "cancelled" }) },
    );
    const status = await persistSubscription(
      context.env,
      identity.uid,
      cancelled,
    );
    return json(
      context.env,
      { status, hasAccess: false },
      200,
      context.request,
    );
  });
}
