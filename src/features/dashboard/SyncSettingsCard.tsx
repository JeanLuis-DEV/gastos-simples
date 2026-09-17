import { Alert, Button, Card, Modal } from "@apps-simples/ui";
import { useEffect, useState } from "react";
import { localCivilDate } from "../../domain/dates";
import { reauthenticateWithGoogle } from "../../services/auth";
import { listSyncConflicts, resolveSyncConflict } from "../../storage/database";
import { SyncHttpError, syncApi } from "../../sync/client";
import { canUseRemoteSync, SYNC_PRIVACY_POLICY_URL } from "../../sync/config";
import type { SyncManager, SyncSnapshot } from "../../sync/engine";
import type { SyncConflict } from "../../sync/types";
import { SYNC_PRIVACY_POLICY_VERSION } from "../../../shared/syncPolicy";


function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function SyncSettingsCard({ ownerUid, manager, snapshot, onChanged, onError, onMessage }: {
  ownerUid: string;
  manager: SyncManager;
  snapshot: SyncSnapshot;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
}) {
  const [consentOpen, setConsentOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const refreshConflicts = () => listSyncConflicts(ownerUid).then(setConflicts);
  useEffect(() => { void refreshConflicts(); }, [ownerUid, snapshot.conflictCount]);
  if (!canUseRemoteSync() || !snapshot.available) return null;

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await action(); }
    catch (error) { onError(error instanceof Error ? error.message : "Não foi possível concluir a ação."); }
    finally { setBusy(false); }
  };

  const exportRemote = () => run(async () => {
    downloadJson(`gastos-simples-remoto-${localCivilDate()}.json`, await syncApi.exportRemote(ownerUid));
    onMessage("Cópia da nuvem baixada.");
  });
  const deleteRemote = () => run(async () => {
    let intent;
    try {
      intent = await syncApi.deletionIntent();
    } catch (error) {
      if (!(error instanceof SyncHttpError) || error.status !== 401) throw error;
      await reauthenticateWithGoogle();
      intent = await syncApi.deletionIntent();
    }
    const { nonce } = intent;
    await syncApi.deleteRemote(nonce);
    setDeleteOpen(false);
    setConfirmation("");
    onMessage("Dados remotos excluídos. Os dados deste dispositivo foram preservados.");
    await manager.refreshStatus();
  });
  const resolve = (conflict: SyncConflict, choice: "local" | "remote") => run(async () => {
    await resolveSyncConflict(ownerUid, conflict.id, choice);
    await refreshConflicts();
    await onChanged();
  });

  return (
    <Card className="sync-settings-card">
      <h2>Seus dados e sincronização</h2>
      <p>Seus dados continuam disponíveis neste navegador mesmo sem conexão. A sincronização é opcional.</p>
      <p><strong>Estado:</strong> {snapshot.enabled ? snapshot.status === "syncing" ? "Sincronizando" : snapshot.status === "offline" ? "Offline" : snapshot.status === "error" ? "Erro ao sincronizar" : snapshot.status === "conflicts" ? "Conflitos pendentes" : "Sincronizado" : "Desativada"}</p>
      {snapshot.lastSyncedAt && <p>Última sincronização neste dispositivo: <time dateTime={snapshot.lastSyncedAt}>{new Date(snapshot.lastSyncedAt).toLocaleString("pt-BR")}</time></p>}
      {snapshot.error && <Alert type="error">{snapshot.error}</Alert>}
      <div className="button-row">
        {!snapshot.enabled ? <Button onClick={() => setConsentOpen(true)} disabled={busy || !snapshot.available}>Ativar sincronização</Button> : <Button onClick={() => void manager.syncNow()} disabled={busy || snapshot.status === "syncing"}>Sincronizar agora</Button>}
      </div>
      <div className="button-row sync-danger-actions">
        {snapshot.enabled && <Button variant="secondary" onClick={() => void run(async () => { await manager.disable(false); onMessage("Sincronização desativada. A cópia remota foi mantida."); })} disabled={busy}>Desativar e manter dados remotos</Button>}
      </div>
      <section className="sync-cloud-data" aria-labelledby="sync-cloud-data-title">
        <h3 id="sync-cloud-data-title">Dados armazenados na nuvem</h3>
        {snapshot.hasRemoteData ? <>
          <div className="button-row">
            {snapshot.canExport && <Button variant="secondary" onClick={() => void exportRemote()} disabled={busy}>Baixar cópia da nuvem</Button>}
            {snapshot.canDelete && <Button variant="danger" onClick={() => setDeleteOpen(true)} disabled={busy}>Excluir dados remotos</Button>}
          </div>
          <p className="settings-note">Excluir os dados remotos não exclui os dados locais, a Conta Google, a assinatura nem registros legais de pagamento. Snapshots técnicos do provedor podem seguir os prazos próprios de retenção.</p>
        </> : <p className="settings-note">Nenhuma cópia financeira está armazenada na nuvem.</p>}
      </section>
      {conflicts.length > 0 && <section aria-labelledby="sync-conflicts-title">
        <h3 id="sync-conflicts-title">Conflitos pendentes</h3>
        {conflicts.map((conflict) => <div className="sync-conflict" key={conflict.id}>
          <p>{conflict.remoteDeleted ? "Este item foi excluído em outro dispositivo, mas também foi alterado aqui." : `O mesmo campo foi alterado em dois dispositivos: ${conflict.conflictingFields.join(", ")}.`}</p>
          <div className="button-row">
            <Button variant="secondary" onClick={() => void resolve(conflict, "remote")} disabled={busy}>{conflict.remoteDeleted ? "Manter excluído" : "Usar versão recebida"}</Button>
            <Button onClick={() => void resolve(conflict, "local")} disabled={busy}>{conflict.remoteDeleted ? "Restaurar minha versão" : "Usar minha versão"}</Button>
          </div>
        </div>)}
      </section>}
      <Modal open={consentOpen} onClose={() => { if (!busy) { setConsentOpen(false); setConsent(false); } }} title="Ativar sincronização" footer={<div className="button-row"><Button variant="secondary" onClick={() => setConsentOpen(false)} disabled={busy}>Agora não</Button><Button disabled={!consent || busy} onClick={() => void run(async () => { await manager.activate(SYNC_PRIVACY_POLICY_VERSION); setConsentOpen(false); setConsent(false); onMessage("Sincronização ativada."); })}>Ativar sincronização</Button></div>}>
        <p>Lançamentos, séries, parcelas, perfis, categorias e os 100 cálculos mais recentes serão enviados com segurança para a Cloudflare e poderão aparecer nos seus outros dispositivos.</p>
        <p>O aplicativo continuará funcionando offline. Você poderá exportar, desativar a sincronização ou solicitar a exclusão definitiva da cópia remota.</p>
        <p><a href={SYNC_PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">Ler a Política de Privacidade</a></p>
        <label className="sync-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> Li as informações e quero ativar a sincronização.</label>
      </Modal>
      <Modal open={deleteOpen} onClose={() => { if (!busy) { setDeleteOpen(false); setConfirmation(""); } }} title="Excluir dados remotos" footer={<div className="button-row"><Button variant="secondary" onClick={() => setDeleteOpen(false)} disabled={busy}>Cancelar</Button><Button variant="danger" onClick={() => void deleteRemote()} disabled={busy || confirmation !== "EXCLUIR"}>Excluir dados remotos</Button></div>}>
        <p>Baixe uma cópia da nuvem antes de continuar, se desejar. Esta ação não apaga os dados deste navegador, a Conta Google, a assinatura nem registros legais de pagamento.</p>
        <label>Digite <strong>EXCLUIR</strong> para confirmar<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
      </Modal>
    </Card>
  );
}
