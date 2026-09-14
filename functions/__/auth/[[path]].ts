const FIREBASE_AUTH_ORIGIN = "https://gastos-simples-8bd4e.firebaseapp.com";
const AUTH_PATH_PREFIX = "/__/auth/";

type AuthProxyContext = { request: Request };

function proxyError(status: number, message: string) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Strict-Transport-Security": "max-age=31536000",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": "frame-ancestors 'self'",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

function firebaseAuthUrl(request: Request) {
  const source = new URL(request.url);
  if (!source.pathname.startsWith(AUTH_PATH_PREFIX))
    throw new Error("Caminho inválido.");

  let decodedPath = source.pathname;
  try {
    for (let index = 0; index < 3; index += 1) {
      const decoded = decodeURIComponent(decodedPath);
      if (decoded === decodedPath) break;
      decodedPath = decoded;
    }
  } catch {
    throw new Error("Caminho inválido.");
  }
  const segments = decodedPath.split("/");
  if (
    decodedPath.includes("\\") ||
    decodedPath.includes("\0") ||
    segments.some((segment) => segment === "." || segment === "..")
  )
    throw new Error("Caminho inválido.");

  const target = new URL(FIREBASE_AUTH_ORIGIN);
  target.pathname = source.pathname;
  target.search = source.search;
  return target;
}

export async function onRequest(context: AuthProxyContext) {
  const { request } = context;
  if (request.method !== "GET" && request.method !== "POST")
    return proxyError(405, "Método não permitido.");

  let target: URL;
  try {
    target = firebaseAuthUrl(request);
  } catch {
    return proxyError(400, "Solicitação inválida.");
  }

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "POST" ? request.body : undefined,
      redirect: "manual",
    });
  } catch {
    return proxyError(502, "Serviço de autenticação temporariamente indisponível.");
  }
  const responseHeaders = new Headers(upstream.headers);
  if (!responseHeaders.has("Strict-Transport-Security"))
    responseHeaders.set("Strict-Transport-Security", "max-age=31536000");
  if (!responseHeaders.has("X-Content-Type-Options"))
    responseHeaders.set("X-Content-Type-Options", "nosniff");
  if (!responseHeaders.has("Referrer-Policy"))
    responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (!responseHeaders.has("X-Frame-Options"))
    responseHeaders.set("X-Frame-Options", "SAMEORIGIN");
  if (!responseHeaders.has("Content-Security-Policy"))
    responseHeaders.set("Content-Security-Policy", "frame-ancestors 'self'");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
