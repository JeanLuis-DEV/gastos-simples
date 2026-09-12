import { describe, expect, it } from "vitest";
import { administrativeUids, hasAdministrativeAccess } from "./admin";

describe("acesso administrativo server-side", () => {
  it("autoriza somente o UID Firebase exato configurado", () => {
    expect(hasAdministrativeAccess("uid-admin", "uid-admin")).toBe(true);
    expect(hasAdministrativeAccess("uid-comum", "uid-admin")).toBe(false);
  });

  it("normaliza espaços e ignora entradas vazias", () => {
    expect(administrativeUids(" uid-1, , uid-2 ,")).toEqual(
      new Set(["uid-1", "uid-2"]),
    );
    expect(hasAdministrativeAccess("uid-2", " uid-1, uid-2 ")).toBe(true);
    expect(hasAdministrativeAccess("uid-1", " , , ")).toBe(false);
  });

  it("não aceita e-mail semelhante, UID parcial ou informação do cliente", () => {
    const clientSupplied = {
      uid: "uid-admin",
      email: "admin@example.com",
      status: "admin",
    };
    expect(hasAdministrativeAccess(clientSupplied.email, "uid-admin")).toBe(false);
    expect(hasAdministrativeAccess("uid-admin-extra", "uid-admin")).toBe(false);
    expect(hasAdministrativeAccess("uid-validado", clientSupplied.uid)).toBe(false);
  });
});
