import { withSecurityHeaders } from "./_shared/http";

type MiddlewareContext = {
  request: Request;
  next(): Promise<Response>;
};

const LEGACY_HOST = "gastos-simples.pages.dev";
const OFFICIAL_ORIGIN = "https://gastos.centralsimples.com.br";

export async function onRequest(context: MiddlewareContext) {
  const url = new URL(context.request.url);
  const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");

  if (url.hostname !== LEGACY_HOST || isApi) return context.next();

  return withSecurityHeaders(
    new Response(null, {
      status: 301,
      headers: {
        Location: `${OFFICIAL_ORIGIN}${url.pathname}${url.search}`,
      },
    }),
  );
}
