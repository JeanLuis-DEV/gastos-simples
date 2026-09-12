const required = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
] as const;

export type PublicConfig = {
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket?: string;
    messagingSenderId: string;
    appId: string;
  };
  apiBaseUrl: string;
};

export function getPublicConfig(
  env: Record<string, string | undefined> = import.meta.env,
): PublicConfig {
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length)
    throw new Error(`Configuração pública incompleta: ${missing.join(", ")}.`);
  return {
    firebase: {
      apiKey: env.VITE_FIREBASE_API_KEY!,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN!,
      projectId: env.VITE_FIREBASE_PROJECT_ID!,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID!,
      appId: env.VITE_FIREBASE_APP_ID!,
    },
    apiBaseUrl: (env.VITE_API_BASE_URL || "/api").replace(/\/$/, ""),
  };
}
