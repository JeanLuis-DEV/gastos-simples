import { getPublicConfig } from "../config";
import type { Entitlement } from "../domain/entitlement";
import { getIdToken } from "./auth";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getIdToken();
  const { apiBaseUrl } = getPublicConfig();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!response.ok)
    throw new Error(body.error || "Serviço temporariamente indisponível.");
  return body;
}
export const getEntitlement = () => request<Entitlement>("/entitlement");
export const startSubscription = () =>
  request<{ checkoutUrl: string }>("/subscription/start", { method: "POST" });
export const cancelSubscription = () =>
  request<{ ok: true }>("/subscription/cancel", { method: "POST" });
