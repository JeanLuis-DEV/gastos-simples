import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("headers estáticos", () => {
  it("permite o helper Firebase same-origin sem permitir framing do app", async () => {
    const headers = await readFile("public/_headers", "utf8");

    expect(headers).toContain("frame-src 'self'");
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toContain("X-Frame-Options: DENY");
  });
});
