import type { Env } from "../types";

const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' https://apis.google.com https://www.gstatic.com https://sdk.mercadopago.com https://http2.mlstatic.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://lh3.googleusercontent.com; connect-src 'self' https://*.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://api.mercadopago.com https://*.mercadopago.com https://api.mercadolibre.com https://http2.mlstatic.com; frame-src https://*.firebaseapp.com https://accounts.google.com https://*.mercadopago.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://www.mercadopago.com.br",
};

export function withSecurityHeaders(response: Response) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS))
    secured.headers.set(name, value);
  return secured;
}

export function json(env: Env, body: unknown, status = 200, request?: Request) {
  const origin = request?.headers.get("Origin");
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...SECURITY_HEADERS,
  };
  if (origin === env.APP_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}
export const safeError = (
  env: Env,
  request: Request,
  message = "Serviço temporariamente indisponível.",
  status = 500,
) => json(env, { error: message }, status, request);
export function requireOrigin(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== env.APP_ORIGIN)
    throw new HttpError(403, "Origem não autorizada.");
}
export function assertEnv(env: Env, keys: Array<keyof Env>) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length)
    throw new HttpError(503, "Serviço ainda não configurado.");
}
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function handle(
  context: { request: Request; env: Env },
  action: () => Promise<Response>,
) {
  try {
    requireOrigin(context.request, context.env);
    return await action();
  } catch (error) {
    if (error instanceof HttpError)
      return safeError(
        context.env,
        context.request,
        error.message,
        error.status,
      );
    return safeError(context.env, context.request);
  }
}
export const onOptions = ({ request, env }: { request: Request; env: Env }) => {
  try {
    requireOrigin(request, env);
    const response = json(env, {}, 204, request);
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, X-Idempotency-Key, X-Request-Id, X-Signature",
    );
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    return response;
  } catch {
    return safeError(env, request, "Origem não autorizada.", 403);
  }
};
