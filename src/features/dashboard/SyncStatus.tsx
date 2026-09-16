import { Button } from "@apps-simples/ui";
import { useState } from "react";
import { canUseRemoteSync } from "../../sync/config";
import type { SyncSnapshot } from "../../sync/engine";

const labels = {
  disabled: "Sincronização desativada",
  syncing: "Sincronizando",
  synced: "Sincronizado",
  offline: "Offline",
  error: "Erro ao sincronizar",
  conflicts: "Conflitos pendentes",
} as const;

export function SyncStatus({ snapshot, onSync }: { snapshot: SyncSnapshot; onSync: () => void | Promise<void> }) {
  const [pending, setPending] = useState(false);
  if (!canUseRemoteSync() || !snapshot.enabled) return null;
  const syncing = pending || snapshot.status === "syncing";
  const exceptional = snapshot.status === "offline" || snapshot.status === "error" || snapshot.status === "conflicts";
  const actionLabel = snapshot.status === "error" ? "Tentar novamente" : syncing ? "Sincronizando…" : "Sincronizar agora";
  const handleSync = async () => {
    if (syncing || snapshot.status === "offline") return;
    setPending(true);
    try {
      await onSync();
    } finally {
      setPending(false);
    }
  };
  return (
    <div className={`sync-control sync-control--${snapshot.status}`}>
      <span
        className={exceptional ? "sync-state" : "sr-only"}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {labels[snapshot.status]}
      </span>
      {snapshot.status !== "offline" && (
        <Button
          size="compact"
          variant="ghost"
          className="sync-action"
          onClick={() => void handleSync()}
          disabled={syncing}
          aria-label={actionLabel}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
