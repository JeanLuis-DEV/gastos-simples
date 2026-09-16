import { describe, expect, it } from "vitest";
import { json, withSecurityHeaders } from "./http";

const env = { APP_ORIGIN: "https://app.test" } as never;

describe("headers de segurança das Pages Functions", () => {
  it("preserva CSP, proteções existentes e HSTS sem preload", () => {
    const response = json(env, { ok: true });
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000",
    );
    expect(response.headers.get("Strict-Transport-Security")).not.toContain(
      "preload",
    );
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-src 'self'",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers.get("Permissions-Policy")).toContain("payment=()");
  });

  it("protege respostas repassadas pelo middleware", () => {
    const response = withSecurityHeaders(new Response("ok"));
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000",
    );
  });
});
