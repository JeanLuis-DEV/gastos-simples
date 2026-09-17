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

function value(name) {
  const match = source.match(
    new RegExp(`${name}:[\\u0060"']([^\\u0060"']+)[\\u0060"']`),
  );
  if (!match) throw new Error(`O build staging não contém ${name}.`);
  return match[1];
}

if (!source.includes(expectedProject))
  throw new Error("O build não contém o projeto Firebase staging esperado.");
if (!source.includes(expectedAuthDomain))
  throw new Error("O build não usa o authDomain same-origin do Pages staging.");
for (const marker of forbiddenProductionMarkers) {
  if (source.includes(marker))
    throw new Error("O build staging contém marcador de produção.");
}
const appProjectNumber = value("VITE_FIREBASE_APP_ID").split(":")[1];
if (!appProjectNumber || value("VITE_FIREBASE_MESSAGING_SENDER_ID") !== appProjectNumber)
  throw new Error("O build staging mistura App ID e Messaging Sender ID.");
if (value("VITE_FIREBASE_STORAGE_BUCKET") !== `${expectedProject}.firebasestorage.app`)
  throw new Error("O build staging não usa o Storage Bucket esperado.");
if (value("VITE_API_BASE_URL") !== "/api")
  throw new Error("O build staging não usa a API same-origin.");
if (value("VITE_SYNC_ENABLED") !== "true" || value("VITE_SYNC_CANARY_ADMIN_ONLY") !== "true")
  throw new Error("O build staging não preserva o canário administrativo.");

console.log("Build staging isolado e com authDomain same-origin validado.");
