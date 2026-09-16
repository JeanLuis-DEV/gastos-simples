import { Alert, Button, Card } from "@apps-simples/ui";
import { useState } from "react";
import { localCivilDate } from "../../domain/dates";
import { exportBackup } from "../../storage/database";
import { canUseRemoteSync } from "../../sync/config";
import { useSync } from "../../sync/useSync";
import { SyncSettingsCard } from "../dashboard/SyncSettingsCard";

export function RestrictedDataArea({ ownerUid }: { ownerUid: string }) {
  const { manager, snapshot } = useSync(ownerUid);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const exportLocal = async () => {
    try {
      const backup = await exportBackup(ownerUid);
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `gastos-simples-backup-${localCivilDate()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("Backup local exportado.");
    } catch (reason) { setError((reason as Error).message); }
  };
  return (
    <section className="restricted-data-area" aria-labelledby="restricted-data-title">
      {message && <Alert type="success">{message}</Alert>}
      {error && <Alert type="error">{error}</Alert>}
      <Card>
        <h2 id="restricted-data-title">Seus dados</h2>
        <p>Seus dados locais não serão apagados quando a assinatura for pausada, cancelada ou expirar.</p>
        <Button variant="secondary" onClick={() => void exportLocal()}>Exportar dados locais</Button>
      </Card>
      {canUseRemoteSync() && <SyncSettingsCard ownerUid={ownerUid} manager={manager} snapshot={snapshot} onChanged={async () => undefined} onError={setError} onMessage={setMessage} />}
    </section>
  );
}
