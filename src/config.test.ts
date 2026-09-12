import { describe, expect, it } from "vitest";
import { getPublicConfig } from "./config";
describe("configuração segura", () => {
  it("falha claramente quando variáveis estão ausentes", () =>
    expect(() => getPublicConfig({})).toThrow(
      /Configuração pública incompleta/,
    ));
  it("não exige segredo no frontend", () => {
    const value = getPublicConfig({
      VITE_FIREBASE_API_KEY: "a",
      VITE_FIREBASE_AUTH_DOMAIN: "b",
      VITE_FIREBASE_PROJECT_ID: "gastos-simples-8bd4e",
      VITE_FIREBASE_MESSAGING_SENDER_ID: "c",
      VITE_FIREBASE_APP_ID: "d",
    });
    expect(Object.keys(value.firebase)).not.toContain("accessToken");
  });
});
