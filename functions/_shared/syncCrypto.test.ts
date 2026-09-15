import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../types";
import { contentHash, decryptPayload, encryptPayload } from "./syncCrypto";

const fixtureKey = (value: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(value)));
const env = (active: string, keys: Record<string, string>) => ({
  SYNC_ACTIVE_KEY_ID: active,
  SYNC_ENCRYPTION_KEYS: JSON.stringify(keys),
}) as Env;

afterEach(() => vi.restoreAllMocks());

describe("criptografia dos dados sincronizados", () => {
  it("usa AES-GCM autenticado sem expor o conteúdo", async () => {
    const consoleSpy = vi.spyOn(console, "log");
    const configuration = env("fixture-v1", { "fixture-v1": fixtureKey(1) });
    const payload = { description: "Salário confidencial", amountCents: 123456 };
    const encrypted = await encryptPayload(configuration, "uid-a", "transaction", "record-a", payload);
    expect(encrypted).toMatchObject({ keyId: "fixture-v1" });
    expect(encrypted.payloadCiphertext).not.toContain("Salário");
    await expect(decryptPayload(configuration, "uid-a", "transaction", "record-a", encrypted)).resolves.toEqual(payload);
    await expect(decryptPayload(configuration, "uid-b", "transaction", "record-a", encrypted)).rejects.toThrow(/indisponíveis/);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("lê chave antiga e grava com a chave ativa durante rotação", async () => {
    const oldEnv = env("fixture-v1", { "fixture-v1": fixtureKey(1) });
    const old = await encryptPayload(oldEnv, "uid", "profile", "profile", { name: "Principal" });
    const rotated = env("fixture-v2", { "fixture-v1": fixtureKey(1), "fixture-v2": fixtureKey(2) });
    await expect(decryptPayload(rotated, "uid", "profile", "profile", old)).resolves.toEqual({ name: "Principal" });
    expect((await encryptPayload(rotated, "uid", "profile", "profile", { name: "Principal" })).keyId).toBe("fixture-v2");
  });

  it("produz hash canônico estável e sensível ao conteúdo", async () => {
    expect(await contentHash({ b: 2, a: 1 })).toBe(await contentHash({ a: 1, b: 2 }));
    expect(await contentHash({ a: 1 })).not.toBe(await contentHash({ a: 2 }));
  });
});
