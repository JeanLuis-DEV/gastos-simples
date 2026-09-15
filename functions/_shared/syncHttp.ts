import { HttpError } from "./http";

export async function readJsonBody(request: Request, maximumBytes: number) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new HttpError(415, "Use conteúdo JSON.");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maximumBytes) throw new HttpError(413, "Solicitação excede o tamanho permitido.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new HttpError(413, "Solicitação excede o tamanho permitido.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
}

export function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === keys.length && keys.every((key) => Object.hasOwn(value as object, key));
}

export function opaqueId(value: unknown, maximum = 128) {
  return typeof value === "string" && value.length >= 1 && value.length <= maximum && /^[A-Za-z0-9:._-]+$/.test(value);
}

export function randomToken(bytes = 32) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
