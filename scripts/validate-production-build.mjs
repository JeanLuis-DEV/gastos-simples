import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const assetsDir = fileURLToPath(new URL("../dist/assets/", import.meta.url));
const bundle = readdirSync(assetsDir)
  .filter((name) => name.endsWith(".js"))
  .map((name) => readFileSync(join(assetsDir, name), "utf8"))
  .join("\n");

const requiredMarkers = [
  "gastos.centralsimples.com.br",
  "gastos-simples-8bd4e",
];
const forbiddenMarkers = [
  "gastos-simples-sync-staging.pages.dev",
  "gastos-simples-staging-dev",
  "gastos-simples-8bd4e.firebaseapp.com",
];

function value(name) {
  const match = bundle.match(
    new RegExp(`${name}:[\\u0060"']([^\\u0060"']+)[\\u0060"']`),
  );
  if (!match) throw new Error(`Production bundle is missing ${name}.`);
  return match[1];
}

for (const marker of requiredMarkers) {
  if (!bundle.includes(marker)) {
    throw new Error(`Production bundle is missing required marker: ${marker}`);
  }
}

for (const marker of forbiddenMarkers) {
  if (bundle.includes(marker)) {
    throw new Error(`Production bundle contains forbidden marker: ${marker}`);
  }
}

if (value("VITE_FIREBASE_AUTH_DOMAIN") !== "gastos.centralsimples.com.br")
  throw new Error("Production bundle does not use the same-origin auth domain.");
if (value("VITE_FIREBASE_PROJECT_ID") !== "gastos-simples-8bd4e")
  throw new Error("Production bundle does not use the production Firebase project.");
if (value("VITE_API_BASE_URL") !== "/api")
  throw new Error("Production bundle does not use the same-origin API.");
if (value("VITE_SYNC_ENABLED") !== "true" || value("VITE_SYNC_CANARY_ADMIN_ONLY") !== "false")
  throw new Error("Production bundle does not enable sync for eligible subscribers.");

console.log("Production bundle configuration validated.");
