import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../_shared/auth", () => ({ authenticate: vi.fn() }));
vi.mock("../../_shared/mercadoPago", () => ({
  validateConfiguredPlan: vi.fn(),
}));

import { authenticate } from "../../_shared/auth";
import { validateConfiguredPlan } from "../../_shared/mercadoPago";
import type { PagesContext } from "../../types";
import { assertPublicKey, onRequestGet } from "./config";

describe("configuração pública do checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticate).mockResolvedValue({
      uid: "firebase-uid",
      email: "user@example.test",
    });
  });

  it("rejeita chave pública malformada", () => {
    expect(() => assertPublicKey("APP_USR-curta")).toThrow(/chave pública/i);
  });

  it("só entrega a chave pública após autenticação e validação do plano", async () => {
    const publicKey = "APP_USR-public-key-12345678901234567890";
    const context = {
      request: new Request("https://app.test/api/subscription/config"),
      env: {
        APP_ORIGIN: "https://gastos.centralsimples.com.br",
        FIREBASE_PROJECT_ID: "project",
        MERCADO_PAGO_ACCESS_TOKEN: "token",
        MERCADO_PAGO_PLAN_ID: "plan",
        MERCADO_PAGO_PUBLIC_KEY: publicKey,
        DB: {} as PagesContext["env"]["DB"],
      },
      waitUntil: vi.fn(),
    } satisfies PagesContext;

    const response = await onRequestGet(context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ publicKey });
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(validateConfiguredPlan).toHaveBeenCalledTimes(1);
  });
});
