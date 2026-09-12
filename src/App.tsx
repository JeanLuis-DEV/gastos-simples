import { Alert, Loading } from "@apps-simples/ui";
import { useEffect, useState } from "react";
import { getPublicConfig } from "./config";
import type { Entitlement } from "./domain/entitlement";
import { DashboardApp } from "./features/dashboard/DashboardApp";
import { LoginView } from "./features/auth/LoginView";
import { PaywallView } from "./features/subscription/PaywallView";
import { getEntitlement, startSubscription } from "./services/api";
import {
  initializeAuth,
  loginWithGoogle,
  logout,
  type AuthUser,
} from "./services/auth";

export function checkoutUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !/(^|\.)mercadopago\.com(?:\.[a-z]{2})?$/i.test(url.hostname)
  )
    throw new Error("O Mercado Pago não forneceu uma URL de checkout válida.");
  return url;
}
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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => subscriptionReturnError());
  const [entitlement, setEntitlement] = useState<Entitlement>();
  const [entitlementLoading, setEntitlementLoading] = useState(false);
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
    let unsubscribe = () => {};
    void initializeAuth((value) => {
      setUser(value);
      setAuthReady(true);
    })
      .then((fn) => {
        unsubscribe = fn;
      })
      .catch((e) => {
        setError((e as Error).message);
        setAuthReady(true);
      });
    return () => unsubscribe();
  }, [configError]);
  const refreshEntitlement = async () => {
    if (!user) return;
    setEntitlementLoading(true);
    setError("");
    try {
      setEntitlement(await getEntitlement());
    } catch (e) {
      setEntitlement({ status: "temporary_error", hasAccess: false });
      setError((e as Error).message);
    } finally {
      setEntitlementLoading(false);
    }
  };
  useEffect(() => {
    if (user) void refreshEntitlement();
    else setEntitlement(undefined);
  }, [user?.uid]);
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
          setBusy(true);
          setError("");
          void loginWithGoogle()
            .catch((e) => setError((e as Error).message))
            .finally(() => setBusy(false));
        }}
      />
    );
  if (!entitlement?.hasAccess)
    return (
      <PaywallView
        entitlement={entitlement}
        error={error}
        loading={entitlementLoading}
        onRefresh={() => void refreshEntitlement()}
        onLogout={() => void logout()}
        onStart={() => {
          if (entitlementLoading) return;
          setError("");
          setEntitlementLoading(true);
          void startSubscription()
            .then(({ checkoutUrl: value }) =>
              location.assign(checkoutUrl(value)),
            )
            .catch((e) => setError((e as Error).message))
            .finally(() => setEntitlementLoading(false));
        }}
      />
    );
  return (
    <DashboardApp
      user={user}
      entitlement={entitlement}
      onLogout={() => void logout()}
    />
  );
}
