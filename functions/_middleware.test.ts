import { describe, expect, it, vi } from "vitest";
import { onRequest } from "./_middleware";

describe("redirecionamento do domínio legado", () => {
  it("redireciona somente o host público exato e preserva caminho e query", async () => {
    const next = vi.fn(async () => new Response("original"));
    const response = await onRequest({
      request: new Request(
        "https://gastos-simples.pages.dev/relatorios?mes=2026-09",
      ),
      next,
    });

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe(
      "https://gastos.centralsimples.com.br/relatorios?mes=2026-09",
    );
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000",
    );
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    "https://gastos-simples.pages.dev/api/entitlement",
    "https://preview.gastos-simples.pages.dev/relatorios?mes=2026-09",
    "https://gastos.centralsimples.com.br/relatorios?mes=2026-09",
  ])("não redireciona API, preview ou domínio oficial: %s", async (url) => {
    const next = vi.fn(async () => new Response("original"));
    const response = await onRequest({ request: new Request(url), next });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("original");
    expect(next).toHaveBeenCalledOnce();
  });
});
