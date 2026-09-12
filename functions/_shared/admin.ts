export function administrativeUids(value?: string): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((uid) => uid.trim())
      .filter(Boolean),
  );
}

export function hasAdministrativeAccess(
  authenticatedUid: string,
  configuredUids?: string,
): boolean {
  return (
    Boolean(authenticatedUid) &&
    administrativeUids(configuredUids).has(authenticatedUid)
  );
}
