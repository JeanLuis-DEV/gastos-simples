import { getApps, initializeApp } from "firebase/app";
import {
  browserSessionPersistence,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  reauthenticateWithPopup,
  type User,
} from "firebase/auth";
import { getPublicConfig } from "../config";

let initialized = false;
let loginInFlight: Promise<void> | undefined;
function auth() {
  const config = getPublicConfig();
  const app = getApps()[0] ?? initializeApp(config.firebase);
  return getAuth(app);
}

export function authErrorMessage(error: unknown) {
  const code = (error as { code?: string })?.code;
  const messages: Record<string, string> = {
    "auth/network-request-failed":
      "Não foi possível conectar ao Google. Verifique sua conexão e tente novamente.",
    "auth/too-many-requests":
      "Muitas tentativas foram feitas. Aguarde alguns instantes e tente novamente.",
    "auth/unauthorized-domain":
      "Este endereço ainda não está autorizado para login. Tente novamente mais tarde.",
    "auth/operation-not-supported-in-this-environment":
      "O login não está disponível neste navegador.",
    "auth/web-storage-unsupported":
      "O navegador bloqueou o armazenamento necessário para manter a sessão.",
    "auth/popup-blocked":
      "O navegador bloqueou a janela de login. Tente novamente.",
    "auth/popup-closed-by-user":
      "A janela de login foi fechada antes da conclusão.",
    "auth/cancelled-popup-request": "A tentativa de login foi cancelada.",
  };
  return (
    (code && messages[code]) ||
    "Não foi possível concluir o login. Tente novamente."
  );
}

async function configurePersistence(instance: ReturnType<typeof getAuth>) {
  if (initialized) return;
  let lastError: unknown;
  for (const persistence of [
    indexedDBLocalPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
  ]) {
    try {
      await setPersistence(instance, persistence);
      initialized = true;
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function initializeAuth(
  onChange: (user: User | null) => void,
  onError: (message: string) => void = () => {},
): () => void {
  const instance = auth();
  const readinessTimeout = setTimeout(
    () =>
      onError(
        "A restauração da sessão demorou mais que o esperado. Tente entrar novamente.",
      ),
    10_000,
  );
  const unsubscribe = onAuthStateChanged(
    instance,
    (user) => {
      clearTimeout(readinessTimeout);
      onChange(user);
    },
    (error) => {
      clearTimeout(readinessTimeout);
      onError(authErrorMessage(error));
    },
  );
  void configurePersistence(instance)
    .then(() => getRedirectResult(instance))
    .catch((error) => onError(authErrorMessage(error)));
  return () => {
    clearTimeout(readinessTimeout);
    unsubscribe();
  };
}

export async function loginWithGoogle() {
  if (loginInFlight) return loginInFlight;
  loginInFlight = startGoogleLogin()
    .catch((error) => {
      throw new Error(authErrorMessage(error));
    })
    .finally(() => {
      loginInFlight = undefined;
    });
  return loginInFlight;
}

async function startGoogleLogin() {
  const instance = auth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const mobile =
    matchMedia("(pointer: coarse)").matches ||
    /Android|iPhone|iPad/i.test(navigator.userAgent);
  if (mobile) return signInWithRedirect(instance, provider);
  try {
    await signInWithPopup(instance, provider);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "auth/popup-blocked")
      await signInWithRedirect(instance, provider);
    else if (
      code !== "auth/popup-closed-by-user" &&
      code !== "auth/cancelled-popup-request"
    )
      throw error;
  }
}

export async function logout() {
  await signOut(auth());
}
export async function reauthenticateWithGoogle() {
  const user = auth().currentUser;
  if (!user) throw new Error("Sessão não autenticada.");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await reauthenticateWithPopup(user, provider);
  } catch (error) {
    throw new Error(authErrorMessage(error));
  }
}
export async function getIdToken(forceRefresh = false) {
  const user = auth().currentUser;
  if (!user) throw new Error("Sessão não autenticada.");
  return user.getIdToken(forceRefresh);
}
export type AuthUser = Pick<User, "uid" | "displayName" | "email" | "photoURL">;
