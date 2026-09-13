import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../_shared/auth", () => ({
  authenticate: vi.fn(),
  registerUser: vi.fn(),
}));
vi.mock("../../_shared/rateLimit", () => ({ rateLimit: vi.fn() }));
vi.mock("../../_shared/mercadoPago", () => ({
  getSubscription: vi.fn(),
  hasAccess: vi.fn(() => true),
  idempotencyKey: vi.fn(async () => "idempotency"),
  mpRequest: vi.fn(),
  persistSubscription: vi.fn(async () => "trial"),
  subscriptionStartAction: vi.fn(),
  validateConfiguredPlan: vi.fn(),
  validateSubscription: vi.fn(),
}));

import { authenticate } from "../../_shared/auth";
import {
  mpRequest,
  persistSubscription,
  validateConfiguredPlan,
} from "../../_shared/mercadoPago";
import type { PagesContext } from "../../types";
import { cardTokenFromBody, onRequestPost } from "./start";

const validToken = "card_token_1234567890";

function context(body: unknown): PagesContext {
  return {
    request: new Request("https://app.test/api/subscription/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env: {
      APP_ORIGIN: "https://gastos-simples.pages.dev",
      FIREBASE_PROJECT_ID: "project",
      MERCADO_PAGO_ACCESS_TOKEN: "token",
      MERCADO_PAGO_PLAN_ID: "plan",
      MERCADO_PAGO_PUBLIC_KEY: "TEST-public-key-12345678901234567890",
      DB: {
        prepare: vi.fn(() => ({
          bind() {
            return this;
          },
          first: vi.fn(async () => null),
          run: vi.fn(async () => ({ success: true })),
          all: vi.fn(async () => ({ success: true, results: [] })),
        })),
        batch: vi.fn(async () => []),
      },
    },
    waitUntil: vi.fn(),
  };
}

describe("início seguro da assinatura", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticate).mockResolvedValue({
      uid: "firebase-uid",
      email: "user@example.test",
    });
    vi.mocked(validateConfiguredPlan).mockResolvedValue({
      plan: { id: "plan", status: "active", back_url: "https://gastos-simples.pages.dev/?assinatura=retorno" },
      account: { id: 123 },
    });
    vi.mocked(mpRequest).mockResolvedValue({
      id: "subscription",
      status: "authorized",
      external_reference: "firebase-uid",
      preapproval_plan_id: "plan",
    });
  });

  it("rejeita corpo sem token de cartão válido", () => {
    expect(() => cardTokenFromBody({ cardTokenId: "curto" })).toThrow(
      /Token do cartão inválido/,
    );
    expect(() => cardTokenFromBody({ cardTokenId: "token com espaço 123456" })).toThrow(
      /Token do cartão inválido/,
    );
  });

  it("vincula token, plano e UID validados sem aceitar dados de ownership do cliente", async () => {
    const response = await onRequestPost(
      context({
        cardTokenId: validToken,
        external_reference: "uid-atacante",
        payer_email: "atacante@example.test",
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ status: "trial", hasAccess: true });
    expect(validateConfiguredPlan).toHaveBeenCalledTimes(1);
    const [, , init] = vi.mocked(mpRequest).mock.calls[0]!;
    const sent = JSON.parse(String(init?.body));
    expect(sent).toMatchObject({
      preapproval_plan_id: "plan",
      external_reference: "firebase-uid",
      payer_email: "user@example.test",
      card_token_id: validToken,
      back_url: "https://gastos-simples.pages.dev/?assinatura=retorno",
      notification_url:
        "https://gastos-simples.pages.dev/api/webhooks/mercado-pago",
      status: "authorized",
    });
    expect(sent).not.toHaveProperty("uid-atacante");
    expect(persistSubscription).toHaveBeenCalledTimes(1);
  });

  it("omite webhook não público durante o teste local", async () => {
    const local = context({ cardTokenId: validToken });
    local.env.APP_ORIGIN = "http://localhost:8788";

    await onRequestPost(local);

    const [, , init] = vi.mocked(mpRequest).mock.calls[0]!;
    const sent = JSON.parse(String(init?.body));
    expect(sent).not.toHaveProperty("notification_url");
    expect(sent.back_url).toBe(
      "https://gastos-simples.pages.dev/?assinatura=retorno",
    );
  });
});
