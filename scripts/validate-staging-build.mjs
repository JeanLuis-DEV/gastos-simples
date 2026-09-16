import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const expectedProject = "gastos-simples-staging-dev";
const expectedAuthDomain = "gastos-simples-sync-staging.pages.dev";
const forbiddenProductionMarkers = [
  "gastos-simples-8bd4e",
  "gastos.centralsimples.com.br",
];

const assetsDirectory = fileURLToPath(new URL("../dist/assets/", import.meta.url));
const files = (await readdir(assetsDirectory)).filter((name) => name.endsWith(".js"));
const bundles = await Promise.all(
  files.map((name) => readFile(join(assetsDirectory, name), "utf8")),
);
const source = bundles.join("\n");

if (!source.includes(expectedProject))
  throw new Error("O build não contém o projeto Firebase staging esperado.");
if (!source.includes(expectedAuthDomain))
  throw new Error("O build não usa o authDomain same-origin do Pages staging.");
for (const marker of forbiddenProductionMarkers) {
  if (source.includes(marker))
    throw new Error("O build staging contém marcador de produção.");
}

console.log("Build staging isolado e com authDomain same-origin validado.");
