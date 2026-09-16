import { Button } from "@apps-simples/ui";
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

export function SyncStatus({ snapshot, onSync }: { snapshot: SyncSnapshot; onSync: () => void }) {
  if (!canUseRemoteSync() || !snapshot.enabled) return null;
  const important = snapshot.status === "error" || snapshot.status === "conflicts";
  return (
    <Button
      size="compact"
      variant="ghost"
      className={`sync-status sync-status--${snapshot.status}`}
      onClick={onSync}
      disabled={snapshot.status === "syncing"}
      aria-label={`${labels[snapshot.status]}. Sincronizar agora`}
    >
      <span className="sync-status-dot" aria-hidden="true" />
      <span aria-live={important ? "polite" : "off"}>{labels[snapshot.status]}</span>
    </Button>
  );
}
