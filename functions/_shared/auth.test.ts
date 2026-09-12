import { describe, expect, it, vi } from "vitest";
import { authenticate, validateFirebaseClaims, type JwtPayload } from "./auth";
const env = { FIREBASE_PROJECT_ID: "gastos-simples-8bd4e" } as never;
describe("token Firebase", () => {
  it("rejeita token ausente", async () =>
    await expect(
      authenticate(new Request("https://app.test"), env),
    ).rejects.toMatchObject({ status: 401 }));
  it("rejeita token malformado", async () =>
    await expect(
      authenticate(
        new Request("https://app.test", {
          headers: { Authorization: "Bearer inválido" },
        }),
        env,
      ),
    ).rejects.toMatchObject({ status: 401 }));
});
describe("claims Firebase", () => {
  const now = 2_000_000_000;
  const valid: JwtPayload = {
    aud: "project",
    iss: "https://securetoken.google.com/project",
    sub: "uid",
    exp: now + 3600,
    iat: now - 10,
    auth_time: now - 20,
    email: "user@example.com",
    email_verified: true,
    firebase: { sign_in_provider: "google.com" },
  };
  const header = { alg: "RS256", kid: "key" };
  it("aceita conjunto completo", () =>
    expect(() =>
      validateFirebaseClaims(header, valid, "project", now),
    ).not.toThrow());
  it.each([
    ["alg", { header: { alg: "HS256" } }],
    ["kid", { header: { kid: "" } }],
    ["exp ausente", { payload: { exp: undefined } }],
    ["exp expirado", { payload: { exp: now } }],
    ["iat ausente", { payload: { iat: undefined } }],
    ["iat futuro", { payload: { iat: now + 1 } }],
    ["auth_time ausente", { payload: { auth_time: undefined } }],
    ["auth_time futuro", { payload: { auth_time: now + 1 } }],
    ["auth_time posterior ao iat", { payload: { auth_time: now - 5 } }],
    ["aud", { payload: { aud: "other" } }],
    ["iss", { payload: { iss: "other" } }],
    ["sub", { payload: { sub: "" } }],
    ["email", { payload: { email: "" } }],
    ["email_verified", { payload: { email_verified: false } }],
    ["provider", { payload: { firebase: { sign_in_provider: "password" } } }],
  ])("rejeita claim crítica %s", (_, raw) => {
    const change = raw as {
      header?: Partial<typeof header>;
      payload?: Partial<JwtPayload>;
    };
    expect(() =>
      validateFirebaseClaims(
        { ...header, ...change.header },
        { ...valid, ...change.payload },
        "project",
        now,
      ),
    ).toThrow();
  });
});

describe("assinatura RS256", () => {
  it("aceita assinatura Google válida e rejeita assinatura adulterada", async () => {
    const keys = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const jwk = (await crypto.subtle.exportKey(
      "jwk",
      keys.publicKey,
    )) as JsonWebKey & { kid?: string };
    jwk.kid = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ keys: [jwk] }), {
            status: 200,
            headers: { "cache-control": "max-age=300" },
          }),
      ),
    );
    const encode = (value: unknown) =>
      btoa(JSON.stringify(value))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    const header = encode({ alg: "RS256", kid: "test-key" });
    const now = Math.floor(Date.now() / 1000);
    const payload = encode({
      aud: "gastos-simples-8bd4e",
      iss: "https://securetoken.google.com/gastos-simples-8bd4e",
      sub: "uid",
      exp: now + 3600,
      iat: now - 1,
      auth_time: now - 2,
      email: "user@example.com",
      email_verified: true,
      firebase: { sign_in_provider: "google.com" },
    });
    const input = `${header}.${payload}`;
    const raw = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keys.privateKey,
      new TextEncoder().encode(input),
    );
    const signature = btoa(String.fromCharCode(...new Uint8Array(raw)))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const request = (value: string) =>
      new Request("https://app.test", {
        headers: { Authorization: `Bearer ${input}.${value}` },
      });
    await expect(authenticate(request(signature), env)).resolves.toMatchObject({
      uid: "uid",
      email: "user@example.com",
    });
    await expect(authenticate(request("AA"), env)).rejects.toMatchObject({
      status: 401,
    });
    vi.unstubAllGlobals();
  });
});
