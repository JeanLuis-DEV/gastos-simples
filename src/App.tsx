import { Alert, Loading } from "@apps-simples/ui";
import { useEffect, useRef, useState } from "react";
import { getPublicConfig } from "./config";
import type { Entitlement } from "./domain/entitlement";
import { DashboardApp } from "./features/dashboard/DashboardApp";
import { LoginView } from "./features/auth/LoginView";
import { PaywallView } from "./features/subscription/PaywallView";
import { SubscriptionCheckoutView } from "./features/subscription/SubscriptionCheckoutView";
import { RestrictedDataArea } from "./features/subscription/RestrictedDataArea";
import {
  getEntitlement,
  getSubscriptionConfig,
  startSubscription,
} from "./services/api";
import {
  initializeAuth,
  loginWithGoogle,
  logout,
  type AuthUser,
} from "./services/auth";
import { hasValidOfflineLease, invalidateSyncLease, recordSuccessfulEntitlement } from "./sync/engine";

export function subscriptionReturnError(search = location.search) {
  const params = new URLSearchParams(search);
  if (params.get("assinatura") !== "retorno") return "";
  const status = (
    params.get("status") ??
    params.get("collection_status") ??
    ""
  ).toLowerCase();
  return ["failure", "failed", "rejected", "cancelled"].includes(status)
    ? "O Mercado Pago informou que a assinatura não foi concluída. Você pode tentar novamente."
    : "";
}

export default function App() {
  const previousUid = useRef<string | undefined>(undefined);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => subscriptionReturnError());
  const [entitlement, setEntitlement] = useState<Entitlement>();
  const [entitlementLoading, setEntitlementLoading] = useState(false);
  const [checkoutPublicKey, setCheckoutPublicKey] = useState("");
  const [offlineLease, setOfflineLease] = useState(false);
  const configError = (() => {
    try {
      getPublicConfig();
      return "";
    } catch (e) {
      return (e as Error).message;
    }
  })();
  useEffect(() => {
    if (configError) {
      setAuthReady(true);
      return;
    }
    const unsubscribe = initializeAuth(
      (value) => {
        if (previousUid.current && previousUid.current !== value?.uid) void invalidateSyncLease(previousUid.current);
        previousUid.current = value?.uid;
        setUser(value);
        setAuthReady(true);
      },
      (message) => {
        setError(message);
        setAuthReady(true);
      },
    );
    return () => unsubscribe();
  }, [configError]);
  const refreshEntitlement = async () => {
    if (!user) return;
    setEntitlementLoading(true);
    setError("");
    try {
      const next = await getEntitlement();
      setEntitlement(next);
      if (next.hasAccess) {
        await recordSuccessfulEntitlement(user.uid, next.serverTime);
        setOfflineLease(true);
      }
    } catch (e) {
      setEntitlement({ status: "temporary_error", hasAccess: false });
      setError((e as Error).message);
    } finally {
      setEntitlementLoading(false);
    }
  };
  useEffect(() => {
    if (user) {
      void refreshEntitlement();
      void hasValidOfflineLease(user.uid).then(setOfflineLease);
    } else {
      setEntitlement(undefined);
      setOfflineLease(false);
    }
  }, [user?.uid]);
  const handleLogout = async () => {
    if (user) await invalidateSyncLease(user.uid);
    await logout();
  };
  if (!authReady)
    return (
      <main className="center-state">
        <Loading label="Iniciando com segurança" />
      </main>
    );
  if (configError)
    return (
      <main className="center-state">
        <Alert type="error" title="Aplicativo ainda não configurado">
          {configError} Consulte o arquivo .env.example.
        </Alert>
      </main>
    );
  if (!user)
    return (
      <LoginView
        busy={busy}
        error={error}
        onLogin={() => {
          if (busy) return;
          setBusy(true);
          setError("");
          void loginWithGoogle()
            .catch((e) =>
              setError(
                e instanceof Error
                  ? e.message
                  : "Não foi possível concluir o login. Tente novamente.",
              ),
            )
            .finally(() => setBusy(false));
        }}
      />
    );
  if (!entitlement?.hasAccess && checkoutPublicKey)
    return (
      <SubscriptionCheckoutView
        email={user.email}
        publicKey={checkoutPublicKey}
        onBack={() => setCheckoutPublicKey("")}
        onSubscribe={async (cardTokenId) => {
          await startSubscription(cardTokenId);
          location.assign("/?assinatura=retorno");
        }}
      />
    );
  if (!entitlement?.hasAccess && !(entitlement?.status === "temporary_error" && offlineLease))
    return (
      <PaywallView
        entitlement={entitlement}
        error={error}
        loading={entitlementLoading}
        onRefresh={() => void refreshEntitlement()}
        onLogout={() => void handleLogout()}
        onStart={() => {
          if (entitlementLoading) return;
          setError("");
          setEntitlementLoading(true);
          void getSubscriptionConfig()
            .then(({ publicKey }) => setCheckoutPublicKey(publicKey))
            .catch((e) => setError((e as Error).message))
            .finally(() => setEntitlementLoading(false));
        }}
      >
        <RestrictedDataArea ownerUid={user.uid} />
      </PaywallView>
    );
  return (
    <DashboardApp
      user={user}
      entitlement={entitlement}
      onLogout={() => void handleLogout()}
      onSubscriptionChanged={setEntitlement}
    />
  );
}
