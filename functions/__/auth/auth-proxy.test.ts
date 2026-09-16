import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "./[[path]]";

afterEach(() => vi.unstubAllGlobals());

describe("proxy same-origin do helper Firebase", () => {
  it("preserva GET, query string, status e content-type", async () => {
    const fetchMock = vi.fn(async (_target: URL, _init: RequestInit) =>
      Promise.resolve(
        new Response("helper", {
          status: 206,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request(
        "https://gastos.centralsimples.com.br/__/auth/iframe?apiKey=public&v=1",
      ),
      env: { FIREBASE_PROJECT_ID: "gastos-simples-8bd4e" },
    });

    const [target, init] = fetchMock.mock.calls[0]!;
    expect(String(target)).toBe(
      "https://gastos-simples-8bd4e.firebaseapp.com/__/auth/iframe?apiKey=public&v=1",
    );
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(await response.text()).toBe("helper");
  });

  it("preserva POST e body", async () => {
    let forwardedBody = "";
    const fetchMock = vi.fn(async (_target: URL, init: RequestInit) => {
      forwardedBody = await new Response(init.body).text();
      return new Response("ok", { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request(
        "https://gastos.centralsimples.com.br/__/auth/handler?state=expected",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "code=one-time",
        },
      ),
      env: { FIREBASE_PROJECT_ID: "gastos-simples-8bd4e" },
    });

    expect(fetchMock.mock.calls[0]![1].method).toBe("POST");
    expect(forwardedBody).toBe("code=one-time");
    expect(response.status).toBe(201);
  });

  it("usa somente o host Firebase fixo e não aceita open proxy", async () => {
    const fetchMock = vi.fn(async (_target: URL, _init: RequestInit) =>
      Promise.resolve(new Response("ok")),
    );
    vi.stubGlobal("fetch", fetchMock);

    await onRequest({
      request: new Request(
        "https://host-injetado.example/__/auth/handler?url=https://evil.example/steal",
      ),
      env: { FIREBASE_PROJECT_ID: "gastos-simples-8bd4e" },
    });

    const target = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(target.origin).toBe(
      "https://gastos-simples-8bd4e.firebaseapp.com",
    );
    expect(target.searchParams.get("url")).toBe("https://evil.example/steal");
    expect(
      (fetchMock.mock.calls[0]![1].headers as Headers).has("host"),
    ).toBe(false);
  });

  it("usa o projeto Firebase isolado recebido do ambiente", async () => {
    const fetchMock = vi.fn(async (_target: URL, _init: RequestInit) =>
      Promise.resolve(new Response("ok")),
    );
    vi.stubGlobal("fetch", fetchMock);

    await onRequest({
      request: new Request("https://staging.example/__/auth/iframe"),
      env: { FIREBASE_PROJECT_ID: "gastos-simples-staging" },
    });

    expect(new URL(String(fetchMock.mock.calls[0]![0])).origin).toBe(
      "https://gastos-simples-staging.firebaseapp.com",
    );
  });

  it("rejeita projeto Firebase inválido sem atuar como open proxy", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://staging.example/__/auth/iframe"),
      env: { FIREBASE_PROJECT_ID: "evil.example/path" },
    });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falha fechado quando o projeto Firebase do ambiente não existe", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://staging.example/__/auth/iframe"),
    });

    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "https://gastos.centralsimples.com.br/__/auth/%252e%252e/private",
    "https://gastos.centralsimples.com.br/__/auth/%255c%255cevil.example",
  ])("bloqueia path traversal: %s", async (url) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request(url),
      env: { FIREBASE_PROJECT_ID: "gastos-simples-8bd4e" },
    });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("permite iframe same-origin sem enfraquecer os headers globais", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("iframe")));
    const response = await onRequest({
      request: new Request(
        "https://gastos.centralsimples.com.br/__/auth/iframe",
      ),
      env: { FIREBASE_PROJECT_ID: "gastos-simples-8bd4e" },
    });

    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(response.headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors 'self'",
    );
  });

  it("preserva headers seguros enviados pelo Firebase", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("handler", {
          headers: {
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
          },
        }),
      ),
    );
    const response = await onRequest({
      request: new Request(
        "https://gastos.centralsimples.com.br/__/auth/handler",
      ),
      env: { FIREBASE_PROJECT_ID: "gastos-simples-8bd4e" },
    });

    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("preserva cookies, redirects e headers necessários do upstream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(null, {
          status: 302,
          headers: {
            Location: "/__/auth/handler?state=next",
            "Set-Cookie": "session=opaque; Path=/; Secure; HttpOnly; SameSite=Lax",
            "Cache-Control": "no-store",
          },
        }),
      ),
    );

    const response = await onRequest({
      request: new Request("https://staging.example/__/auth/handler"),
      env: { FIREBASE_PROJECT_ID: "gastos-simples-staging-dev" },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/__/auth/handler?state=next",
    );
    expect(response.headers.get("Set-Cookie")).toContain("session=opaque");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
