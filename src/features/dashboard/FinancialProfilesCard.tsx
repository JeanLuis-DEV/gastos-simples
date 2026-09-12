import { Button, Card, Input, Modal } from "@apps-simples/ui";
import { useEffect, useRef, useState } from "react";
import type { FinancialProfile, Transaction } from "../../domain/models";
import { addFinancialProfile, deleteFinancialProfile, renameFinancialProfile } from "../../storage/database";
import { ProfileSelect } from "./ProfileSelect";

export function FinancialProfilesCard({ ownerUid, profiles, transactions, selectedProfileId, onChanged, onSelectionChanged, onError, onMessage }: {
  ownerUid: string;
  profiles: FinancialProfile[];
  transactions: Transaction[];
  selectedProfileId: string;
  onChanged: () => Promise<void>;
  onSelectionChanged: (profileId: string) => Promise<void>;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
}) {
  const [creating, setCreating] = useState(false), [editing, setEditing] = useState<FinancialProfile>(), [deleting, setDeleting] = useState<FinancialProfile>();
  const [name, setName] = useState(""), [destinationId, setDestinationId] = useState(""), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const restoreFocus = () => setTimeout(() => trigger.current?.focus(), 0);
  const closeEditor = () => { if (!busy) { setCreating(false); setEditing(undefined); restoreFocus(); } };
  const closeDelete = () => { if (!busy) { setDeleting(undefined); restoreFocus(); } };
  const linkedCount = deleting ? transactions.filter((item) => item.profileId === deleting.id).length : 0;
  useEffect(() => { setName(editing?.name ?? ""); }, [editing, creating]);
  useEffect(() => { setDestinationId(profiles.find((item) => item.id !== deleting?.id)?.id ?? ""); }, [deleting, profiles]);
  const save = async () => {
    if (lock.current) return;
    try {
      lock.current = true; setBusy(true);
      if (editing) await renameFinancialProfile(ownerUid, editing.id, name);
      else await addFinancialProfile(ownerUid, name);
      setCreating(false); setEditing(undefined); restoreFocus(); onMessage(editing ? "Perfil renomeado." : "Perfil criado.");
      await onChanged();
    } catch (error) { onError((error as Error).message); }
    finally { lock.current = false; setBusy(false); }
  };
  const remove = async () => {
    if (!deleting || lock.current) return;
    try {
      lock.current = true; setBusy(true);
      const result = await deleteFinancialProfile(ownerUid, deleting.id, linkedCount ? destinationId : undefined);
      if (selectedProfileId === deleting.id) await onSelectionChanged(result.destinationId ?? "");
      setDeleting(undefined); restoreFocus(); onMessage(result.transferred ? `${result.transferred} lançamento(s) transferido(s) e perfil excluído.` : "Perfil excluído.");
      await onChanged();
    } catch (error) { onError((error as Error).message); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Card className="profiles-card">
    <div className="card-heading"><h2>Perfis financeiros</h2><Button size="compact" onClick={(event) => { trigger.current = event.currentTarget; setCreating(true); }}>Novo perfil</Button></div>
    <ul className="profile-list">
      {profiles.map((profile) => {
        const count = transactions.filter((item) => item.profileId === profile.id).length;
        return <li key={profile.id}>
          <span><strong>{profile.name}</strong><small>{count} lançamento(s){selectedProfileId === profile.id ? " · Selecionado" : ""}</small></span>
          <div className="profile-actions">
            <Button className="profile-icon-button" size="compact" variant="ghost" aria-label={`Renomear perfil ${profile.name}`} title={`Renomear perfil ${profile.name}`} onClick={(event) => { trigger.current = event.currentTarget; setEditing(profile); }}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m4 16.5-.75 4.25L7.5 20 19.4 8.1l-3.5-3.5L4 16.5Zm10.5-10.5 3.5 3.5M3.25 20.75h17.5" /></svg>
            </Button>
            <Button className="profile-icon-button profile-icon-button--danger" size="compact" variant="ghost" aria-label={`Excluir perfil ${profile.name}`} title={`Excluir perfil ${profile.name}`} disabled={profiles.length <= 1} onClick={(event) => { trigger.current = event.currentTarget; setDeleting(profile); }}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" /></svg>
            </Button>
          </div>
        </li>;
      })}
    </ul>
    <Modal open={creating || Boolean(editing)} onClose={closeEditor} title={editing ? "Renomear perfil" : "Novo perfil"} footer={<div className="button-row"><Button variant="secondary" disabled={busy} onClick={closeEditor}>Cancelar</Button><Button disabled={busy} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar"}</Button></div>}>
      <Input autoFocus label="Nome do perfil" required maxLength={40} value={name} onChange={(event) => setName(event.target.value)} />
    </Modal>
    <Modal open={Boolean(deleting)} onClose={closeDelete} title="Excluir perfil" footer={<div className="button-row"><Button variant="secondary" disabled={busy} onClick={closeDelete}>Cancelar</Button><Button variant="danger" disabled={busy || (linkedCount > 0 && !destinationId)} onClick={() => void remove()}>{busy ? "Processando…" : "Excluir perfil"}</Button></div>}>
      <p>Confirme a exclusão do perfil “{deleting?.name}”.</p>
      {linkedCount > 0 && <><p>Os {linkedCount} lançamento(s), inclusive excluídos logicamente, devem ser transferidos.</p><ProfileSelect autoFocus label="Perfil de destino" profiles={profiles.filter((item) => item.id !== deleting?.id)} value={destinationId} onChange={setDestinationId} /></>}
    </Modal>
  </Card>;
}
