import { authenticate, registerUser } from "../../_shared/auth";
import { handle, HttpError, json, assertEnv } from "../../_shared/http";
import {
  getSubscription,
  idempotencyKey,
  mpRequest,
  persistSubscription,
  subscriptionStartAction,
  validateSubscription,
  type MercadoSubscription,
} from "../../_shared/mercadoPago";
import { rateLimit } from "../../_shared/rateLimit";
import type { PagesContext } from "../../types";
export async function onRequestPost(context: PagesContext) {
  return handle(context, async () => {
    assertEnv(context.env, ["MERCADO_PAGO_PLAN_ID", "APP_ORIGIN"]);
    const identity = await authenticate(context.request, context.env);
    await rateLimit(context.env, `subscription:start:${identity.uid}`, 5, 300);
    await registerUser(identity, context.env);
    const stored = await context.env.DB.prepare(
      "SELECT mp_subscription_id FROM subscriptions WHERE firebase_uid=?",
    )
      .bind(identity.uid)
      .first<{ mp_subscription_id: string | null }>();
    let previousId = "new";
    if (stored?.mp_subscription_id) {
      const current = await getSubscription(
        context.env,
        stored.mp_subscription_id,
      );
      await validateSubscription(context.env, identity.uid, current);
      previousId = current.id;
      const action = subscriptionStartAction(current);
      if (action === "access")
        throw new HttpError(409, "A assinatura já está ativa.");
      if (action === "paused")
        throw new HttpError(
          409,
          "A assinatura está pausada. Regularize-a no Mercado Pago.",
        );
      if (action === "reuse")
        return json(
          context.env,
          { checkoutUrl: current.init_point },
          200,
          context.request,
        );
    }
    const key = await idempotencyKey(
      `${identity.uid}:${context.env.MERCADO_PAGO_PLAN_ID}:${previousId}`,
    );
    const subscription = await mpRequest<MercadoSubscription>(
      context.env,
      "/preapproval",
      {
        method: "POST",
        headers: { "X-Idempotency-Key": key },
        body: JSON.stringify({
          preapproval_plan_id: context.env.MERCADO_PAGO_PLAN_ID,
          reason: "Gastos Simples Premium",
          external_reference: identity.uid,
          payer_email: identity.email,
          back_url: `${context.env.APP_ORIGIN}/?assinatura=retorno`,
          notification_url: `${context.env.APP_ORIGIN}/api/webhooks/mercado-pago`,
          status: "pending",
        }),
      },
    );
    if (!subscription.init_point)
      throw new HttpError(502, "Checkout indisponível.");
    await persistSubscription(context.env, identity.uid, subscription);
    return json(
      context.env,
      { checkoutUrl: subscription.init_point },
      200,
      context.request,
    );
  });
}
