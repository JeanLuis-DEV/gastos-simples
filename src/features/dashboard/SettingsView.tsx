import { Button, Card, Modal } from "@apps-simples/ui";
import { useRef, useState } from "react";
import { localCivilDate } from "../../domain/dates";
import type { Entitlement } from "../../domain/entitlement";
import { cancelSubscription } from "../../services/api";
import type { AuthUser } from "../../services/auth";
import type { FinancialProfile, Transaction } from "../../domain/models";
import {
  exportBackup,
  importBackup,
  resetUserData,
  validateBackup,
  type Backup,
} from "../../storage/database";
import { ConfirmModal } from "./ConfirmModal";
import { InstitutionalContent } from "./InstitutionalContent";
import { FinancialProfilesCard } from "./FinancialProfilesCard";
import type { FeedbackProps } from "./types";
type Action = "clear" | "cancel" | undefined;
export function SettingsView({
  user,
  entitlement,
  onLogout,
  onChanged,
  onError,
  onMessage,
  profiles = [],
  transactions = [],
  selectedProfileId = "",
  onProfilesChanged = async () => undefined,
  onProfileSelectionChanged = async () => undefined,
  onExportReport = () => undefined,
}: {
  user: AuthUser;
  entitlement: Entitlement;
  onLogout: () => void;
  profiles?: FinancialProfile[];
  transactions?: Transaction[];
  selectedProfileId?: string;
  onProfilesChanged?: () => Promise<void>;
  onProfileSelectionChanged?: (profileId: string) => Promise<void>;
  onExportReport?: (trigger: HTMLElement) => void;
} & FeedbackProps) {
  const [action, setAction] = useState<Action>(),
    [backupToImport, setBackupToImport] = useState<Backup>(),
    [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const resetTriggerRef = useRef<HTMLElement | null>(null);
  const exportData = async () => {
    try {
      const data = await exportBackup(user.uid);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `gastos-simples-backup-${localCivilDate()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onMessage("Backup exportado.");
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const chooseFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0];
      if (file)
        setBackupToImport(
          validateBackup(JSON.parse(await file.text()), user.uid),
        );
    } catch (error) {
      onError((error as Error).message);
    } finally {
      e.target.value = "";
    }
  };
  const closeImport = () => {
    if (!busy) setBackupToImport(undefined);
  };
  const closeAction = () => {
    if (busy) return;
    const restoreResetFocus = action === "clear";
    setAction(undefined);
    if (restoreResetFocus) setTimeout(() => resetTriggerRef.current?.focus(), 0);
  };
  const restore = async (mode: "replace" | "merge") => {
    if (!backupToImport || busy) return;
    try {
      setBusy(true);
      await importBackup(user.uid, backupToImport, mode);
      setBackupToImport(undefined);
      onMessage(
        mode === "replace"
          ? "Dados substituídos pelo backup."
          : "Backup mesclado aos dados atuais.",
      );
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const confirmAction = async () => {
    if (!action || busy) return;
    try {
      setBusy(true);
      if (action === "clear") {
        await resetUserData(user.uid);
        await onProfileSelectionChanged("");
        onMessage("Aplicativo reiniciado. Seus dados locais foram removidos.");
        await onChanged();
      } else {
        await cancelSubscription();
        onMessage("Cancelamento solicitado ao Mercado Pago.");
      }
      setAction(undefined);
      if (action === "clear") setTimeout(() => resetTriggerRef.current?.focus(), 0);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="settings-title">
      <div className="section-heading">
        <h1 id="settings-title">Ajustes</h1>
      </div>
      <div className="settings-grid">
        <FinancialProfilesCard
          ownerUid={user.uid}
          profiles={profiles}
          transactions={transactions}
          selectedProfileId={selectedProfileId}
          onChanged={onProfilesChanged}
          onSelectionChanged={onProfileSelectionChanged}
          onError={onError}
          onMessage={onMessage}
        />
        <Card className="reports-card">
          <h2>Relatórios</h2>
          <p>Gere um relatório financeiro por perfil, período e categoria.</p>
          <Button variant="secondary" onClick={(event) => onExportReport(event.currentTarget)}>
            Exportar relatório
          </Button>
        </Card>
        <Card>
          <h2>Backup local</h2>
          <p>
            O JSON contém seus dados financeiros e deve ser guardado com
            segurança.
          </p>
          <div className="button-row backup-actions">
            <Button onClick={() => void exportData()}>Exportar JSON</Button>
            <Button
              variant="secondary"
              onClick={() => fileRef.current?.click()}
            >
              Importar JSON
            </Button>
            <input
              ref={fileRef}
              className="file-input"
              type="file"
              accept="application/json,.json"
              onChange={(e) => void chooseFile(e)}
            />
          </div>
          <div className="reset-action">
            <Button
              variant="danger"
              onClick={(event) => {
                resetTriggerRef.current = event.currentTarget;
                setAction("clear");
              }}
            >
              Começar do zero
            </Button>
          </div>
        </Card>
        <Card className="account-subscription-card">
          <section
            className="account-subscription-section"
            aria-labelledby="google-account-title"
          >
            <h2 id="google-account-title">Conta Google</h2>
            <p className="account-identification">
              <strong>{user.displayName || "Usuário"}</strong>
              <span>{user.email}</span>
            </p>
            <Button variant="secondary" onClick={onLogout}>
              Sair
            </Button>
          </section>
          <section
            className="account-subscription-section account-subscription-section--subscription"
            aria-labelledby="subscription-title"
          >
            <h2 id="subscription-title">Assinatura</h2>
            <p>
              Situação:{" "}
              <strong>
                {entitlement.status === "admin"
                  ? "Acesso administrativo"
                  : entitlement.status}
              </strong>
            </p>
            {["active", "trial", "paused"].includes(entitlement.status) && (
              <Button variant="danger" onClick={() => setAction("cancel")}>
                Cancelar assinatura
              </Button>
            )}
          </section>
        </Card>
        <InstitutionalContent />
      </div>
      <ConfirmModal
        open={Boolean(action)}
        title={
          action === "clear" ? "Começar do zero" : "Cancelar assinatura"
        }
        confirmLabel={
          action === "clear" ? "Sim, começar do zero" : "Solicitar cancelamento"
        }
        danger
        busy={busy}
        onClose={closeAction}
        onConfirm={() => void confirmAction()}
      >
        <p>
          {action === "clear"
            ? "Todos os lançamentos, perfis financeiros, categorias personalizadas e cálculos desta conta serão removidos deste navegador. Sua conta Google e sua assinatura não serão excluídas."
            : "A renovação será cancelada no Mercado Pago. O estado final depende da confirmação do provedor."}
        </p>
      </ConfirmModal>
      <Modal
        open={Boolean(backupToImport)}
        onClose={closeImport}
        title="Importar backup"
        footer={
          <div className="button-row">
            <Button variant="secondary" onClick={closeImport} disabled={busy}>
              Cancelar
            </Button>
            <Button
              variant="secondary"
              onClick={() => void restore("merge")}
              disabled={busy}
            >
              Mesclar
            </Button>
            <Button onClick={() => void restore("replace")} disabled={busy}>
              Substituir
            </Button>
          </div>
        }
      >
        <p>
          <strong>Mesclar</strong> mantém os dados atuais e adiciona o conteúdo
          do backup. Itens com o mesmo identificador serão atualizados.
          <br />
          <strong>Substituir</strong> remove os dados atuais desta conta antes
          da importação. O arquivo já foi validado.
        </p>
      </Modal>
    </section>
  );
}
