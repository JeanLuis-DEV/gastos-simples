import { authenticate, registerUser } from "../_shared/auth";
import { hasAdministrativeAccess } from "../_shared/admin";
import { handle, json } from "../_shared/http";
import { getSubscription, persistSubscription } from "../_shared/mercadoPago";
import type { PagesContext } from "../types";
export async function onRequestGet(context: PagesContext) {
  return handle(context, async () => {
    const identity = await authenticate(context.request, context.env);
    if (hasAdministrativeAccess(identity.uid, context.env.ADMIN_FIREBASE_UIDS))
      return json(
        context.env,
        { status: "admin", hasAccess: true },
        200,
        context.request,
      );
    await registerUser(identity, context.env);
    const stored = await context.env.DB.prepare(
      "SELECT mp_subscription_id FROM subscriptions WHERE firebase_uid=?",
    )
      .bind(identity.uid)
      .first<{ mp_subscription_id: string | null }>();
    if (!stored?.mp_subscription_id)
      return json(
        context.env,
        { status: "none", hasAccess: false },
        200,
        context.request,
      );
    const subscription = await getSubscription(
      context.env,
      stored.mp_subscription_id,
    );
    const status = await persistSubscription(
      context.env,
      identity.uid,
      subscription,
    );
    return json(
      context.env,
      {
        status,
        hasAccess: ["active", "trial"].includes(status),
        nextPaymentAt: subscription.next_payment_date,
      },
      200,
      context.request,
    );
  });
}
