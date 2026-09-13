import { describe, expect, it } from "vitest";
import {
  reconcileWebhook,
  validateWebhookSignature,
  webhookEventKey,
} from "./mercado-pago";
async function signature(
  secret: string,
  id: string,
  requestId: string,
  ts: string,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const raw = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      `id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`,
    ),
  );
  return Array.from(new Uint8Array(raw))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
describe("assinatura do webhook", () => {
  it("valida id canônico, request id, HMAC e timestamp em segundos", async () => {
    const now = 2_000_000_000_000,
      ts = String(now / 1000),
      v1 = await signature("secret", "ABC", "req-1", ts);
    const request = new Request("https://app.test", {
      headers: { "x-request-id": "req-1", "x-signature": `ts=${ts},v1=${v1}` },
    });
    await expect(
      validateWebhookSignature(request, "secret", "ABC", now),
    ).resolves.toBeUndefined();
  });
  it("aceita timestamp oficial em milissegundos", async () => {
    const now = 2_000_000_000_000,
      ts = String(now),
      v1 = await signature("secret", "p1", "req-1", ts);
    await expect(
      validateWebhookSignature(
        new Request("https://app.test", {
          headers: {
            "x-request-id": "req-1",
            "x-signature": `ts=${ts},v1=${v1}`,
          },
        }),
        "secret",
        "p1",
        now,
      ),
    ).resolves.toBeUndefined();
  });
  it("rejeita replay, HMAC incorreto e request id ausente", async () => {
    const now = 2_000_000_000_000;
    await expect(
      validateWebhookSignature(
        new Request("https://app.test", {
          headers: { "x-request-id": "r", "x-signature": "ts=1,v1=bad" },
        }),
        "secret",
        "p1",
        now,
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      validateWebhookSignature(
        new Request("https://app.test", {
          headers: { "x-signature": `ts=${now / 1000},v1=bad` },
        }),
        "secret",
        "p1",
        now,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
});
describe("idempotência do webhook", () => {
  it("repete a mesma chave para a mesma atualização e muda com provider_updated_at", async () => {
    const first = await webhookEventKey(
      "preapproval",
      "p1",
      "2028-01-01T00:00:00.000Z",
    );
    expect(
      await webhookEventKey("preapproval", "p1", "2028-01-01T00:00:00.000Z"),
    ).toBe(first);
    expect(
      await webhookEventKey("preapproval", "p1", "2028-01-02T00:00:00.000Z"),
    ).not.toBe(first);
  });
});
describe("recuperação do webhook", () => {
  it("pode repetir após falha entre persistência e registro do evento", async () => {
    let recorded = false,
      attempts = 0;
    const persist = async () => {
      attempts++;
    };
    await expect(
      reconcileWebhook({
        exists: async () => recorded,
        persist,
        record: async () => {
          throw new Error("falha parcial");
        },
      }),
    ).rejects.toThrow("falha parcial");
    expect(attempts).toBe(1);
    await expect(
      reconcileWebhook({
        exists: async () => recorded,
        persist,
        record: async () => {
          recorded = true;
        },
      }),
    ).resolves.toBe("processed");
    expect(attempts).toBe(2);
    await expect(
      reconcileWebhook({
        exists: async () => recorded,
        persist,
        record: async () => {
          recorded = true;
        },
      }),
    ).resolves.toBe("duplicate");
    expect(attempts).toBe(2);
  });

  it("aceita atualização antiga sem sobrescrever o estado atual", async () => {
    let persisted = false;
    let result = "";
    await expect(
      reconcileWebhook({
        exists: async () => false,
        isOlder: async () => true,
        persist: async () => {
          persisted = true;
        },
        record: async (value) => {
          result = value;
        },
      }),
    ).resolves.toBe("stale");
    expect(persisted).toBe(false);
    expect(result).toBe("stale");
  });
});
