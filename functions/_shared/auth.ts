import type { AuthIdentity, Env } from "../types";
import { HttpError, assertEnv } from "./http";

export type JwtHeader = { alg?: string; kid?: string };
export type JwtPayload = {
  aud?: string;
  iss?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  firebase?: { sign_in_provider?: string };
};
let cachedKeys: { expiresAt: number; keys: JsonWebKey[] } | undefined;
function decodePart<T>(part: string): T {
  const value = part.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(value.padEnd(Math.ceil(value.length / 4) * 4, "="));
  return JSON.parse(
    new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))),
  ) as T;
}
function signatureBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function getKeys() {
  if (cachedKeys && cachedKeys.expiresAt > Date.now()) return cachedKeys.keys;
  const response = await fetch(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  );
  if (!response.ok)
    throw new HttpError(503, "Não foi possível validar a sessão.");
  const data = (await response.json()) as { keys: JsonWebKey[] };
  const maxAge = Number(
    response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] ?? 300,
  );
  cachedKeys = { keys: data.keys, expiresAt: Date.now() + maxAge * 1000 };
  return data.keys;
}
export async function authenticate(
  request: Request,
  env: Env,
): Promise<AuthIdentity> {
  assertEnv(env, ["FIREBASE_PROJECT_ID"]);
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer "))
    throw new HttpError(401, "Sessão ausente.");
  const token = authorization.slice(7);
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "Sessão inválida.");
  let header: JwtHeader, payload: JwtPayload;
  try {
    header = decodePart(parts[0]!);
    payload = decodePart(parts[1]!);
  } catch {
    throw new HttpError(401, "Sessão inválida.");
  }
  validateFirebaseClaims(header, payload, env.FIREBASE_PROJECT_ID);
  const jwk = (await getKeys()).find(
    (key) =>
      (key as JsonWebKey & { kid?: string }).kid === header.kid &&
      key.kty === "RSA",
  );
  if (!jwk) throw new HttpError(401, "Sessão inválida.");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signatureBytes(parts[2]!),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new HttpError(401, "Sessão inválida.");
  return {
    uid: payload.sub!,
    email: payload.email!.trim().toLowerCase(),
    name: payload.name,
    authTime: payload.auth_time,
  };
}

export function validateFirebaseClaims(
  header: JwtHeader,
  payload: JwtPayload,
  projectId: string,
  now = Math.floor(Date.now() / 1000),
) {
  const validTimestamp = (value: unknown) =>
    Number.isInteger(value) && (value as number) > 0;
  const invalid =
    header.alg !== "RS256" ||
    typeof header.kid !== "string" ||
    !header.kid.trim() ||
    payload.aud !== projectId ||
    payload.iss !== `https://securetoken.google.com/${projectId}` ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    payload.sub.length > 128 ||
    !validTimestamp(payload.exp) ||
    payload.exp! <= now ||
    !validTimestamp(payload.iat) ||
    payload.iat! > now ||
    payload.iat! >= payload.exp! ||
    !validTimestamp(payload.auth_time) ||
    payload.auth_time! > now ||
    payload.auth_time! > payload.iat! ||
    typeof payload.email !== "string" ||
    !payload.email.trim() ||
    payload.email.length > 320 ||
    payload.email_verified !== true ||
    payload.firebase?.sign_in_provider !== "google.com";
  if (invalid) throw new HttpError(401, "Sessão inválida ou expirada.");
}
export async function registerUser(identity: AuthIdentity, env: Env) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users (firebase_uid,email,public_name,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(firebase_uid) DO UPDATE SET email=excluded.email,public_name=excluded.public_name,updated_at=excluded.updated_at",
  )
    .bind(identity.uid, identity.email, identity.name ?? null, now, now)
    .run();
}
