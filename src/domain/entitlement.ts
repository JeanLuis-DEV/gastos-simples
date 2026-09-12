export type EntitlementStatus =
  | "admin"
  | "none"
  | "pending"
  | "trial"
  | "active"
  | "in_process"
  | "paused"
  | "cancelled"
  | "rejected"
  | "expired"
  | "temporary_error";
export type Entitlement = {
  status: EntitlementStatus;
  hasAccess: boolean;
  nextPaymentAt?: string;
  trialEndsAt?: string;
};

export function mapMercadoPagoStatus(
  status: string,
  now = new Date(),
  endDate?: string,
): Entitlement {
  const normalized = status.toLowerCase();
  if (endDate && new Date(endDate) <= now)
    return { status: "expired", hasAccess: false };
  if (normalized === "authorized") return { status: "active", hasAccess: true };
  if (normalized === "trial")
    return { status: "trial", hasAccess: true, trialEndsAt: endDate };
  if (normalized === "pending") return { status: "pending", hasAccess: false };
  if (normalized === "in_process")
    return { status: "in_process", hasAccess: false };
  if (normalized === "paused") return { status: "paused", hasAccess: false };
  if (normalized === "cancelled")
    return { status: "cancelled", hasAccess: false };
  if (normalized === "rejected")
    return { status: "rejected", hasAccess: false };
  return { status: "temporary_error", hasAccess: false };
}
