import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../_shared/auth", () => ({ authenticate: vi.fn() }));
vi.mock("../../_shared/rateLimit", () => ({ rateLimit: vi.fn() }));
vi.mock("../../_shared/mercadoPago", () => ({
  getSubscription: vi.fn(),
  mpRequest: vi.fn(),
  persistSubscription: vi.fn(),
  validateSubscription: vi.fn(),
}));

import { authenticate } from "../../_shared/auth";
import {
  getSubscription,
  mpRequest,
  persistSubscription,
  validateSubscription,
} from "../../_shared/mercadoPago";
import type { PagesContext } from "../../types";
import { onRequestPost } from "./cancel";

const mockedGetSubscription = vi.mocked(getSubscription);
const mockedMpRequest = vi.mocked(mpRequest);

function context(): PagesContext {
  vi.mocked(authenticate).mockResolvedValue({
    uid: "uid-user",
    email: "user@example.test",
  });
  return {
    request: new Request("https://app.test/api/subscription/cancel", {
      method: "POST",
    }),
    env: {
      APP_ORIGIN: "https://app.test",
      FIREBASE_PROJECT_ID: "project",
      MERCADO_PAGO_ACCESS_TOKEN: "token",
      MERCADO_PAGO_PLAN_ID: "plan",
      DB: {
        prepare: vi.fn(() => ({
          bind() {
            return this;
          },
          first: vi.fn(async () => ({ mp_subscription_id: "subscription" })),
          run: vi.fn(async () => ({ success: true })),
          all: vi.fn(async () => ({ success: true, results: [] })),
        })),
        batch: vi.fn(async () => []),
      } as never,
    },
    waitUntil: vi.fn(),
  };
}

describe("cancelamento de assinatura", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cancela uma assinatura autorizada e persiste a confirmação", async () => {
    vi.mocked(persistSubscription).mockResolvedValue("cancelled");
    mockedGetSubscription.mockResolvedValue({
      id: "subscription",
      status: "authorized",
    });
    mockedMpRequest.mockResolvedValue({
      id: "subscription",
      status: "cancelled",
    });
    const response = await onRequestPost(context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "cancelled",
      hasAccess: false,
    });
    expect(mockedMpRequest).toHaveBeenCalledTimes(1);
    expect(mockedMpRequest).toHaveBeenCalledWith(
      expect.anything(),
      "/preapproval/subscription",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ status: "cancelled" }),
      }),
    );
    expect(persistSubscription).toHaveBeenCalledTimes(1);
  });

  it("impede novo envio quando o provedor já confirma cancelamento", async () => {
    mockedGetSubscription.mockResolvedValue({
      id: "subscription",
      status: "cancelled",
    });
    const response = await onRequestPost(context());
    expect(response.status).toBe(409);
    expect(validateSubscription).toHaveBeenCalledTimes(1);
    expect(mockedMpRequest).not.toHaveBeenCalled();
    expect(persistSubscription).not.toHaveBeenCalled();
  });
});
