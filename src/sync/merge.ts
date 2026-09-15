import type { SyncPayload } from "./types";

const TECHNICAL_FIELDS = new Set([
  "localVersion",
  "serverVersion",
  "serverRevision",
  "deletedAt",
  "createdAt",
  "updatedAt",
]);

export type MergeResult<T extends SyncPayload> =
  | { status: "merged"; value: T }
  | { status: "conflict"; value: T; conflictingFields: string[] };

export function threeWayMerge<T extends SyncPayload>(
  base: T,
  local: T,
  remote: T,
): MergeResult<T> {
  if (base.id !== local.id || base.id !== remote.id || base.ownerUid !== local.ownerUid || base.ownerUid !== remote.ownerUid)
    throw new Error("Não é possível mesclar registros de identidades diferentes.");
  if (remote.isDeleted === true && base.isDeleted !== true)
    return { status: "merged", value: remote };

  const value = { ...remote } as T;
  const conflicts: string[] = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  for (const key of keys) {
    if (TECHNICAL_FIELDS.has(key) || key === "id" || key === "ownerUid") continue;
    const baseValue = (base as unknown as Record<string, unknown>)[key];
    const localValue = (local as unknown as Record<string, unknown>)[key];
    const remoteValue = (remote as unknown as Record<string, unknown>)[key];
    const localChanged = !Object.is(baseValue, localValue);
    const remoteChanged = !Object.is(baseValue, remoteValue);
    if (localChanged && remoteChanged && !Object.is(localValue, remoteValue)) {
      conflicts.push(key);
      continue;
    }
    if (localChanged && !remoteChanged)
      (value as unknown as Record<string, unknown>)[key] = localValue;
  }
  return conflicts.length
    ? { status: "conflict", value, conflictingFields: conflicts.sort() }
    : { status: "merged", value };
}
