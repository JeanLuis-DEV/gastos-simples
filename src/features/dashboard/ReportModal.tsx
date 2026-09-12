import { Button, Input, Modal } from "@apps-simples/ui";
import { useId, useState } from "react";
import { sortCategories } from "../../domain/categories";
import { localCivilDate } from "../../domain/dates";
import type { Category, FinancialProfile, Transaction } from "../../domain/models";
import { buildReportModel } from "../../domain/report";
import { ProfileSelect } from "./ProfileSelect";
import { AccessibleSelect } from "./AccessibleSelect";

export function ReportModal({ open, ownerUid, transactions, profiles, categories, onClose, onError, onMessage }: {
  open: boolean;
  ownerUid: string;
  transactions: Transaction[];
  profiles: FinancialProfile[];
  categories: Category[];
  onClose: () => void;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
}) {
  const today = localCivilDate();
  const [profileId, setProfileId] = useState(""), [categoryId, setCategoryId] = useState("");
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`), [to, setTo] = useState(today), [busy, setBusy] = useState(false);
  const errorId = useId();
  const invalidRange = Boolean(from && to && from > to);
  const close = () => { if (!busy) onClose(); };
  const exportPdf = async () => {
    if (busy) return;
    try {
      setBusy(true);
      const model = buildReportModel(ownerUid, transactions, profiles, categories, { profileId, categoryId, from, to });
      const { generatePdfReport } = await import("../../services/pdfReport");
      await generatePdfReport(model);
      onMessage("Relatório PDF gerado localmente.");
      onClose();
    } catch (error) { onError((error as Error).message); }
    finally { setBusy(false); }
  };
  return <Modal open={open} onClose={close} title="Exportar relatório" footer={<div className="button-row"><Button variant="secondary" disabled={busy} onClick={close}>Cancelar</Button><Button disabled={busy || invalidRange} onClick={() => void exportPdf()}>{busy ? "Gerando…" : "Exportar PDF"}</Button></div>}>
    <div className="form-grid">
      <ProfileSelect autoFocus label="Perfil" profiles={profiles} includeAll value={profileId} onChange={setProfileId} />
      <AccessibleSelect label="Categoria" value={categoryId} onChange={setCategoryId} options={[{ value: "", label: "Todas as categorias" }, ...sortCategories(categories).map((category) => ({ value: category.id, label: `${category.name} · ${category.type === "income" ? "Receita" : "Despesa"}` }))]} />
      <Input label="Data inicial" type="date" required value={from} aria-invalid={invalidRange} aria-describedby={invalidRange ? errorId : undefined} onChange={(event) => setFrom(event.target.value)} />
      <Input label="Data final" type="date" required value={to} aria-invalid={invalidRange} aria-describedby={invalidRange ? errorId : undefined} onChange={(event) => setTo(event.target.value)} />
    </div>
    {invalidRange && <p id={errorId} className="field-error" role="alert">A data inicial deve ser anterior ou igual à data final.</p>}
    <p className="muted">O PDF é gerado neste navegador e não é enviado ao servidor.</p>
  </Modal>;
}
