import type { Env } from "../types";
import { HttpError } from "./http";

export type EncryptedPayload = {
  payloadCiphertext: string;
  payloadIv: string;
  keyId: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new HttpError(503, "Sincronização ainda não configurada.");
  }
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalize(item)]));
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(normalize(value));
}

export async function contentHash(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(canonicalJson(value)));
  return bytesToBase64(new Uint8Array(digest))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function configuredKeys(env: Env) {
  if (!env.SYNC_ACTIVE_KEY_ID || !env.SYNC_ENCRYPTION_KEYS)
    throw new HttpError(503, "Sincronização ainda não configurada.");
  let values: Record<string, unknown>;
  try {
    values = JSON.parse(env.SYNC_ENCRYPTION_KEYS) as Record<string, unknown>;
  } catch {
    throw new HttpError(503, "Sincronização ainda não configurada.");
  }
  const entries = new Map<string, Uint8Array>();
  for (const [keyId, encoded] of Object.entries(values)) {
    if (typeof encoded !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) continue;
    const bytes = base64ToBytes(encoded);
    if (bytes.byteLength === 32) entries.set(keyId, bytes);
  }
  if (!entries.has(env.SYNC_ACTIVE_KEY_ID))
    throw new HttpError(503, "Sincronização ainda não configurada.");
  return { activeKeyId: env.SYNC_ACTIVE_KEY_ID, entries };
}

async function importAesKey(bytes: Uint8Array) {
  return crypto.subtle.importKey("raw", Uint8Array.from(bytes).buffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function additionalData(ownerUid: string, entityType: string, recordId: string) {
  return encoder.encode(`${ownerUid}:${entityType}:${recordId}`);
}

export async function encryptPayload(
  env: Env,
  ownerUid: string,
  entityType: string,
  recordId: string,
  payload: unknown,
): Promise<EncryptedPayload> {
  const { activeKeyId, entries } = configuredKeys(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey(entries.get(activeKeyId)!);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(ownerUid, entityType, recordId), tagLength: 128 },
    key,
    encoder.encode(canonicalJson(payload)),
  );
  return { payloadCiphertext: bytesToBase64(new Uint8Array(encrypted)), payloadIv: bytesToBase64(iv), keyId: activeKeyId };
}

export async function decryptPayload<T>(
  env: Env,
  ownerUid: string,
  entityType: string,
  recordId: string,
  encrypted: EncryptedPayload,
): Promise<T> {
  const { entries } = configuredKeys(env);
  const bytes = entries.get(encrypted.keyId);
  if (!bytes) throw new HttpError(503, "Dados temporariamente indisponíveis.");
  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(encrypted.payloadIv),
        additionalData: additionalData(ownerUid, entityType, recordId),
        tagLength: 128,
      },
      await importAesKey(bytes),
      base64ToBytes(encrypted.payloadCiphertext),
    );
    return JSON.parse(decoder.decode(decrypted)) as T;
  } catch {
    throw new HttpError(500, "Dados temporariamente indisponíveis.");
  }
}
