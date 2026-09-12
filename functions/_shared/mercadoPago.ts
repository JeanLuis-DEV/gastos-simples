import type { Env } from "../types";
import { HttpError, assertEnv } from "./http";
export type MercadoSubscription = {
  id: string;
  status: string;
  version?: number;
  application_id?: number;
  collector_id?: number;
  external_reference?: string;
  init_point?: string;
  preapproval_plan_id?: string;
  next_payment_date?: string;
  date_created?: string;
  last_modified?: string;
  auto_recurring?: {
    end_date?: string;
    free_trial?: { frequency: number; frequency_type: string };
  };
};
export type MercadoPlan = {
  id: string;
  status: string;
  application_id?: number;
  collector_id?: number;
  auto_recurring?: {
    frequency: number;
    frequency_type: string;
    transaction_amount: number | string;
    currency_id: string;
    repetitions?: number;
    free_trial?: { frequency: number; frequency_type: string };
  };
};
export type MercadoAccount = { id: number };
export async function mpRequest<T>(
  env: Env,
  path: string,
  init?: RequestInit,
): Promise<T> {
  assertEnv(env, ["MERCADO_PAGO_ACCESS_TOKEN"]);
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.MERCADO_PAGO_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok)
    throw new HttpError(
      response.status >= 500 ? 503 : 400,
      "Não foi possível processar a assinatura.",
    );
  return response.json() as Promise<T>;
}
export const getSubscription = (env: Env, id: string) =>
  mpRequest<MercadoSubscription>(env, `/preapproval/${encodeURIComponent(id)}`);
export async function validateConfiguredPlan(env: Env) {
  assertEnv(env, ["MERCADO_PAGO_PLAN_ID"]);
  const [plan, account] = await Promise.all([
    mpRequest<MercadoPlan>(
      env,
      `/preapproval_plan/${encodeURIComponent(env.MERCADO_PAGO_PLAN_ID)}`,
    ),
    mpRequest<MercadoAccount>(env, "/users/me"),
  ]);
  const recurring = plan.auto_recurring;
  const amount = Number(recurring?.transaction_amount);
  if (
    plan.id !== env.MERCADO_PAGO_PLAN_ID ||
    plan.status !== "active" ||
    !Number.isSafeInteger(account.id) ||
    plan.collector_id !== account.id ||
    !recurring ||
    recurring.frequency !== 1 ||
    recurring.frequency_type !== "months" ||
    amount !== 1.99 ||
    recurring.currency_id !== "BRL" ||
    (recurring.repetitions !== undefined && recurring.repetitions > 0) ||
    recurring.free_trial?.frequency !== 7 ||
    recurring.free_trial.frequency_type !== "days"
  )
    throw new HttpError(
      503,
      "O plano Premium está configurado incorretamente.",
    );
  return { plan, account };
}
function trialEnd(subscription: MercadoSubscription) {
  const trial = subscription.auto_recurring?.free_trial;
  if (!trial || !subscription.date_created) return undefined;
  const date = new Date(subscription.date_created);
  if (trial.frequency_type === "days")
    date.setUTCDate(date.getUTCDate() + trial.frequency);
  else if (trial.frequency_type === "months")
    date.setUTCMonth(date.getUTCMonth() + trial.frequency);
  else return undefined;
  return date.toISOString();
}
export function normalizedStatus(
  subscription: MercadoSubscription,
  now = new Date(),
) {
  const subscriptionEnd = subscription.auto_recurring?.end_date;
  if (
    subscriptionEnd &&
    Number.isFinite(Date.parse(subscriptionEnd)) &&
    new Date(subscriptionEnd) <= now
  )
    return "expired";
  const end = trialEnd(subscription);
  if (subscription.status === "authorized" && end && new Date(end) > now)
    return "trial";
  const map: Record<string, string> = {
    authorized: "active",
    pending: "pending",
    in_process: "in_process",
    paused: "paused",
    cancelled: "cancelled",
    rejected: "rejected",
  };
  return map[subscription.status] ?? "rejected";
}
export const hasAccess = (
  subscription: MercadoSubscription,
  now = new Date(),
) => ["active", "trial"].includes(normalizedStatus(subscription, now));
export function assertExternalReference(
  subscription: MercadoSubscription,
  uid: string,
) {
  if (subscription.external_reference !== uid)
    throw new HttpError(409, "Assinatura vinculada de forma inválida.");
}
export function assertSubscriptionPlan(
  subscription: MercadoSubscription,
  env: Pick<Env, "MERCADO_PAGO_PLAN_ID">,
) {
  if (
    !env.MERCADO_PAGO_PLAN_ID ||
    subscription.preapproval_plan_id !== env.MERCADO_PAGO_PLAN_ID
  )
    throw new HttpError(409, "Assinatura pertence a outro plano.");
}
export function assertSubscriptionOwnership(
  subscription: MercadoSubscription,
  plan: MercadoPlan,
  account: MercadoAccount,
) {
  if (
    !Number.isSafeInteger(subscription.collector_id) ||
    !Number.isSafeInteger(subscription.application_id) ||
    !Number.isSafeInteger(plan.application_id) ||
    subscription.collector_id !== account.id ||
    subscription.collector_id !== plan.collector_id ||
    subscription.application_id !== plan.application_id
  )
    throw new HttpError(
      409,
      "Assinatura não pertence à conta Mercado Pago autenticada.",
    );
}
export async function validateSubscription(
  env: Env,
  uid: string,
  subscription: MercadoSubscription,
) {
  assertExternalReference(subscription, uid);
  assertSubscriptionPlan(subscription, env);
  if (
    !subscription.id ||
    ![
      "authorized",
      "pending",
      "in_process",
      "paused",
      "cancelled",
      "rejected",
    ].includes(subscription.status)
  )
    throw new HttpError(409, "Estado da assinatura inválido.");
  const { plan, account } = await validateConfiguredPlan(env);
  assertSubscriptionOwnership(subscription, plan, account);
}
export function providerTimestamp(subscription: MercadoSubscription) {
  const value = subscription.last_modified ?? subscription.date_created;
  if (!value || !Number.isFinite(Date.parse(value)))
    throw new HttpError(409, "Assinatura sem versão válida do provedor.");
  return new Date(value).toISOString();
}
export function isOlderProviderUpdate(
  incoming: string,
  current?: string | null,
) {
  return Boolean(current && Date.parse(incoming) < Date.parse(current));
}
export async function persistSubscription(
  env: Env,
  uid: string,
  subscription: MercadoSubscription,
) {
  await validateSubscription(env, uid, subscription);
  const now = new Date().toISOString();
  const providerUpdated = providerTimestamp(subscription);
  const normalized = normalizedStatus(subscription);
  await env.DB.prepare(
    `INSERT INTO subscriptions (firebase_uid,mp_subscription_id,plan_id,status_normalized,status_original,trial_end_at,next_payment_at,provider_updated_at,created_at,updated_at,last_verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(firebase_uid) DO UPDATE SET mp_subscription_id=excluded.mp_subscription_id,plan_id=excluded.plan_id,status_normalized=excluded.status_normalized,status_original=excluded.status_original,trial_end_at=excluded.trial_end_at,next_payment_at=excluded.next_payment_at,provider_updated_at=excluded.provider_updated_at,updated_at=excluded.updated_at,last_verified_at=excluded.last_verified_at WHERE subscriptions.provider_updated_at IS NULL OR excluded.provider_updated_at>=subscriptions.provider_updated_at`,
  )
    .bind(
      uid,
      subscription.id,
      subscription.preapproval_plan_id!,
      normalized,
      subscription.status,
      trialEnd(subscription) ?? null,
      subscription.next_payment_date ?? null,
      providerUpdated,
      subscription.date_created ?? now,
      now,
      now,
    )
    .run();
  const persisted = await env.DB.prepare(
    "SELECT status_normalized FROM subscriptions WHERE firebase_uid=?",
  )
    .bind(uid)
    .first<{ status_normalized: string }>();
  if (!persisted)
    throw new HttpError(503, "Não foi possível reconciliar a assinatura.");
  return persisted.status_normalized;
}
export function subscriptionStartAction(
  subscription: MercadoSubscription,
  now = new Date(),
): "access" | "reuse" | "paused" | "create" {
  const status = normalizedStatus(subscription, now);
  if (status === "active" || status === "trial") return "access";
  if (status === "paused") return "paused";
  if (status === "pending" && subscription.init_point) {
    const created = subscription.date_created
      ? Date.parse(subscription.date_created)
      : Number.NaN;
    if (
      Number.isFinite(created) &&
      now.getTime() - created >= 0 &&
      now.getTime() - created < 24 * 60 * 60 * 1000
    )
      return "reuse";
  }
  return "create";
}
export async function idempotencyKey(value: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
