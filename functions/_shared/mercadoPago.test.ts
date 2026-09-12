import { describe, expect, it } from "vitest";
import {
  assertExternalReference,
  assertSubscriptionOwnership,
  assertSubscriptionPlan,
  isOlderProviderUpdate,
  normalizedStatus,
  providerTimestamp,
  subscriptionStartAction,
} from "./mercadoPago";
describe("assinatura Mercado Pago", () => {
  it("identifica período gratuito real do plano", () => {
    expect(
      normalizedStatus(
        {
          id: "p",
          status: "authorized",
          external_reference: "u",
          date_created: "2028-01-01T00:00:00Z",
          auto_recurring: {
            free_trial: { frequency: 7, frequency_type: "days" },
          },
        },
        new Date("2028-01-03"),
      ),
    ).toBe("trial");
  });
  it("rejeita external_reference divergente", () =>
    expect(() =>
      assertExternalReference(
        { id: "p", status: "authorized", external_reference: "outro" },
        "u",
      ),
    ).toThrow(/vinculada/));
  it("rejeita assinatura de outro plano", () =>
    expect(() =>
      assertSubscriptionPlan(
        { id: "p", status: "authorized", preapproval_plan_id: "outro" },
        { MERCADO_PAGO_PLAN_ID: "oficial" },
      ),
    ).toThrow(/outro plano/));
  it("rejeita assinatura de outra conta ou aplicação", () =>
    expect(() =>
      assertSubscriptionOwnership(
        { id: "p", status: "authorized", collector_id: 2, application_id: 10 },
        { id: "plan", status: "active", collector_id: 1, application_id: 10 },
        { id: 1 },
      ),
    ).toThrow(/conta Mercado Pago/));
  it("permite nova assinatura após cancelamento e reutiliza somente pendência recente", () => {
    expect(subscriptionStartAction({ id: "old", status: "cancelled" })).toBe(
      "create",
    );
    expect(
      subscriptionStartAction(
        {
          id: "pending",
          status: "pending",
          init_point: "https://checkout",
          date_created: "2028-01-01T00:00:00Z",
        },
        new Date("2028-01-01T01:00:00Z"),
      ),
    ).toBe("reuse");
    expect(
      subscriptionStartAction(
        {
          id: "expired-checkout",
          status: "pending",
          init_point: "https://checkout",
          date_created: "2027-12-30T00:00:00Z",
        },
        new Date("2028-01-01T01:00:00Z"),
      ),
    ).toBe("create");
  });
  it("não cria duplicata ativa e trata pausa", () => {
    expect(subscriptionStartAction({ id: "a", status: "authorized" })).toBe(
      "access",
    );
    expect(subscriptionStartAction({ id: "p", status: "paused" })).toBe(
      "paused",
    );
  });
  it("não reverte estado com atualização fora de ordem", () => {
    const recent = providerTimestamp({
      id: "p",
      status: "authorized",
      last_modified: "2028-02-02T10:00:00-03:00",
    });
    const old = providerTimestamp({
      id: "p",
      status: "pending",
      last_modified: "2028-02-01T15:00:00Z",
    });
    expect(isOlderProviderUpdate(old, recent)).toBe(true);
    expect(isOlderProviderUpdate(recent, old)).toBe(false);
  });
});
