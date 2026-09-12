import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_shared/auth", () => ({
  authenticate: vi.fn(),
  registerUser: vi.fn(),
}));
vi.mock("../_shared/mercadoPago", () => ({
  getSubscription: vi.fn(),
  persistSubscription: vi.fn(),
}));

import { authenticate, registerUser } from "../_shared/auth";
import { getSubscription } from "../_shared/mercadoPago";
import { onRequestGet } from "./entitlement";
import type { PagesContext } from "../types";

const mockedAuthenticate = vi.mocked(authenticate);
const mockedRegisterUser = vi.mocked(registerUser);
const mockedGetSubscription = vi.mocked(getSubscription);

function context(uid: string, body?: object): PagesContext {
  mockedAuthenticate.mockResolvedValue({
    uid,
    email: `${uid}@example.test`,
  });
  return {
    request: new Request("https://app.test/api/entitlement", {
      method: body ? "POST" : "GET",
      body: body ? JSON.stringify(body) : undefined,
      headers: body ? { "Content-Type": "application/json" } : undefined,
    }),
    env: {
      ADMIN_FIREBASE_UIDS: "uid-admin",
      APP_ORIGIN: "https://app.test",
      FIREBASE_PROJECT_ID: "project",
      MERCADO_PAGO_ACCESS_TOKEN: "token",
      MERCADO_PAGO_PLAN_ID: "plan",
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

describe("endpoint de entitlement administrativo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna admin sem consultar D1 ou Mercado Pago", async () => {
    const ctx = context("uid-admin");
    const response = await onRequestGet(ctx);
    expect(await response.json()).toEqual({ status: "admin", hasAccess: true });
    expect(mockedRegisterUser).not.toHaveBeenCalled();
    expect(ctx.env.DB.prepare).not.toHaveBeenCalled();
    expect(mockedGetSubscription).not.toHaveBeenCalled();
  });

  it("ignora UID, e-mail e status enviados pelo cliente", async () => {
    const response = await onRequestGet(
      context("uid-comum", {
        uid: "uid-admin",
        email: "uid-admin@example.test",
        status: "admin",
      }),
    );
    expect(await response.json()).toEqual({ status: "none", hasAccess: false });
    expect(mockedRegisterUser).toHaveBeenCalledTimes(1);
    expect(mockedGetSubscription).not.toHaveBeenCalled();
  });
});
