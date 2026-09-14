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

  it.each([
    "https://gastos.centralsimples.com.br/__/auth/%252e%252e/private",
    "https://gastos.centralsimples.com.br/__/auth/%255c%255cevil.example",
  ])("bloqueia path traversal: %s", async (url) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({ request: new Request(url) });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("permite iframe same-origin sem enfraquecer os headers globais", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("iframe")));
    const response = await onRequest({
      request: new Request(
        "https://gastos.centralsimples.com.br/__/auth/iframe",
      ),
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
    });

    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
