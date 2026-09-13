import { authenticate, registerUser } from "../../_shared/auth";
import { COMMERCIAL_PLAN } from "../../../shared/commercialPlan";
import { handle, HttpError, json, assertEnv } from "../../_shared/http";
import {
  getSubscription,
  hasAccess,
  idempotencyKey,
  mpRequest,
  persistSubscription,
  subscriptionStartAction,
  validateConfiguredPlan,
  validateSubscription,
  type MercadoSubscription,
} from "../../_shared/mercadoPago";
import { rateLimit } from "../../_shared/rateLimit";
import type { PagesContext } from "../../types";

export function cardTokenFromBody(body: unknown) {
  const token =
    body && typeof body === "object" && "cardTokenId" in body
      ? (body as { cardTokenId?: unknown }).cardTokenId
      : undefined;
  if (
    typeof token !== "string" ||
    token.length < 16 ||
    token.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  )
    throw new HttpError(400, "Token do cartão inválido.");
  return token;
}

export async function onRequestPost(context: PagesContext) {
  return handle(context, async () => {
    assertEnv(context.env, ["MERCADO_PAGO_PLAN_ID", "APP_ORIGIN"]);
    const identity = await authenticate(context.request, context.env);
    await rateLimit(context.env, `subscription:start:${identity.uid}`, 5, 300);
    await registerUser(identity, context.env);
    const cardTokenId = cardTokenFromBody(
      await context.request.json().catch(() => undefined),
    );
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
        throw new HttpError(
          409,
          "A assinatura anterior ainda está pendente. Atualize o status.",
        );
    }
    const { plan } = await validateConfiguredPlan(context.env);
    const payerEmail =
      context.env.MERCADO_PAGO_TEST_PAYER_EMAIL?.trim() || identity.email;
    const key = await idempotencyKey(
      `${identity.uid}:${context.env.MERCADO_PAGO_PLAN_ID}:${previousId}:${cardTokenId}`,
    );
    const payload: Record<string, unknown> = {
      preapproval_plan_id: context.env.MERCADO_PAGO_PLAN_ID,
      reason: COMMERCIAL_PLAN.reason,
      external_reference: identity.uid,
      payer_email: payerEmail,
      card_token_id: cardTokenId,
      back_url: plan.back_url,
      status: "authorized",
    };
    if (context.env.APP_ORIGIN.startsWith("https://"))
      payload.notification_url = `${context.env.APP_ORIGIN}/api/webhooks/mercado-pago`;
    const subscription = await mpRequest<MercadoSubscription>(
      context.env,
      "/preapproval",
      {
        method: "POST",
        headers: { "X-Idempotency-Key": key },
        body: JSON.stringify(payload),
      },
    );
    const status = await persistSubscription(
      context.env,
      identity.uid,
      subscription,
    );
    return json(
      context.env,
      { status, hasAccess: hasAccess(subscription) },
      201,
      context.request,
    );
  });
}
