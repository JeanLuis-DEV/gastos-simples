import { getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import { getPublicConfig } from "../config";

let initialized = false;
function auth() {
  const config = getPublicConfig();
  const app = getApps()[0] ?? initializeApp(config.firebase);
  return getAuth(app);
}

export async function initializeAuth(
  onChange: (user: User | null) => void,
): Promise<() => void> {
  const instance = auth();
  if (!initialized) {
    await setPersistence(instance, browserLocalPersistence);
    initialized = true;
  }
  await getRedirectResult(instance);
  return onAuthStateChanged(instance, onChange);
}

export async function loginWithGoogle() {
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
export async function getIdToken() {
  const user = auth().currentUser;
  if (!user) throw new Error("Sessão não autenticada.");
  return user.getIdToken();
}
export type AuthUser = Pick<User, "uid" | "displayName" | "email" | "photoURL">;
