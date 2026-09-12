import { Alert, Button, EmptyState } from "@apps-simples/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "../../domain/money";
import type {
  Transaction,
  TransactionFilters as Filters,
} from "../../domain/models";
import {
  markSettled,
  selectSeriesItems,
  transactionsForView,
  type SeriesScope,
} from "../../domain/transactions";
import { transactionsRepository } from "../../storage/database";
import { ConfirmModal } from "./ConfirmModal";
import { AccessibleSelect } from "./AccessibleSelect";
import { TransactionFilters } from "./TransactionFilters";
import { TransactionForm, type TransactionPrefill } from "./TransactionForm";
import type { DataProps } from "./types";

export function TransactionsView({
  ownerUid,
  items,
  categories,
  profiles = [],
  selectedProfileId = "",
  onChanged,
  onError,
  onMessage,
  month,
  prefill,
  onPrefillUsed,
}: DataProps & {
  month: string;
  prefill?: TransactionPrefill;
  onPrefillUsed: () => void;
  selectedProfileId?: string;
}) {
  const [open, setOpen] = useState(Boolean(prefill)),
    [editing, setEditing] = useState<Transaction>(),
    [filters, setFilters] = useState<Filters>({}),
    [deleting, setDeleting] = useState<Transaction>(),
    [deleteScope, setDeleteScope] = useState<SeriesScope>("single"),
    [deleteBusy, setDeleteBusy] = useState(false),
    [settling, setSettling] = useState<Transaction>(),
    [settleBusy, setSettleBusy] = useState(false),
    [duplicating, setDuplicating] = useState<Transaction>(),
    [duplicateBusy, setDuplicateBusy] = useState(false),
    [duplicateError, setDuplicateError] = useState(""),
    [lastDeleted, setLastDeleted] = useState<Transaction[]>([]);
  const settleLock = useRef(false);
  const settleTrigger = useRef<HTMLButtonElement | null>(null);
  const duplicateLock = useRef(false);
  const duplicateTrigger = useRef<HTMLButtonElement | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const hasRange = Boolean(filters.from || filters.to);
  const shown = useMemo(
    () =>
      transactionsForView(items, month, { ...filters, profileId: selectedProfileId || undefined }).sort((a, b) =>
        a.dueDate.localeCompare(b.dueDate),
      ),
    [items, month, filters, selectedProfileId],
  );
  useEffect(() => {
    if (prefill) {
      setEditing(undefined);
      setOpen(true);
    }
  }, [prefill]);
  const restoreSettleFocus = () => {
    queueMicrotask(() => settleTrigger.current?.focus());
  };
  const closeSettle = () => {
    if (settleLock.current) return;
    setSettling(undefined);
    restoreSettleFocus();
  };
  const settle = async () => {
    if (!settling || settleLock.current) return;
    try {
      settleLock.current = true;
      setSettleBusy(true);
      await transactionsRepository.put(markSettled(settling));
      await onChanged();
      onMessage(
        settling.type === "expense"
          ? "Despesa marcada como paga."
          : "Receita marcada como recebida.",
      );
      setSettling(undefined);
      restoreSettleFocus();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      settleLock.current = false;
      setSettleBusy(false);
    }
  };
  const restoreDuplicateFocus = () =>
    setTimeout(() => duplicateTrigger.current?.focus(), 0);
  const closeDuplicate = () => {
    if (duplicateLock.current) return;
    setDuplicating(undefined);
    setDuplicateError("");
    restoreDuplicateFocus();
  };
  const duplicate = async () => {
    if (!duplicating || duplicateLock.current) return;
    try {
      duplicateLock.current = true;
      setDuplicateBusy(true);
      setDuplicateError("");
      const now = new Date().toISOString();
      await transactionsRepository.put({
        ...duplicating,
        id: crypto.randomUUID(),
        seriesId: undefined,
        occurrenceKey: `single:${crypto.randomUUID()}`,
        kind: "single",
        installmentCurrent: undefined,
        installmentTotal: undefined,
        status: "pending",
        paidAt: undefined,
        isDeleted: false,
        createdAt: now,
        updatedAt: now,
      });
      onMessage("Lançamento duplicado como lançamento à vista.");
      setDuplicating(undefined);
      restoreDuplicateFocus();
      try {
        await onChanged();
      } catch (refreshError) {
        onError((refreshError as Error).message);
      }
    } catch (e) {
      setDuplicateError((e as Error).message);
    } finally {
      duplicateLock.current = false;
      setDuplicateBusy(false);
    }
  };
  const restoreDeleteFocus = () =>
    queueMicrotask(() => deleteTrigger.current?.focus());
  const closeDelete = () => {
    if (deleteBusy) return;
    setDeleting(undefined);
    restoreDeleteFocus();
  };
  const remove = async () => {
    if (!deleting || deleteBusy) return;
    try {
      setDeleteBusy(true);
      const now = new Date().toISOString();
      const targets = selectSeriesItems(items, deleting, deleteScope);
      await transactionsRepository.putMany(
        targets.map((i) => ({ ...i, isDeleted: true, updatedAt: now })),
      );
      setLastDeleted(targets);
      setDeleting(undefined);
      restoreDeleteFocus();
      onMessage(
        targets.length > 1
          ? "Ocorrências futuras excluídas."
          : "Lançamento excluído.",
      );
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  };
  const requestDelete = (item: Transaction, trigger: HTMLButtonElement) => {
    deleteTrigger.current = trigger;
    setDeleting(item);
    setDeleteScope("single");
  };
  const undoDelete = async () => {
    if (!lastDeleted.length) return;
    try {
      const now = new Date().toISOString();
      await transactionsRepository.putMany(
        lastDeleted.map((item) => ({ ...item, isDeleted: false, updatedAt: now })),
      );
      setLastDeleted([]);
      onMessage("Exclusão desfeita.");
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <section aria-labelledby="transactions-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Controle financeiro</p>
          <h1 id="transactions-title">Lançamentos</h1>
        </div>
        <Button
          onClick={() => {
            setEditing(undefined);
            setOpen(true);
          }}
        >
          Novo lançamento
        </Button>
      </div>
      <TransactionFilters
        filters={filters}
        categories={categories}
        onChange={setFilters}
      />
      {lastDeleted.length > 0 && (
        <Alert type="info">
          <div className="undo-message">
            <span>
              {lastDeleted.length > 1
                ? `${lastDeleted.length} lançamentos excluídos.`
                : "Lançamento excluído."}
            </span>
            <Button size="compact" variant="secondary" onClick={() => void undoDelete()}>
              Desfazer
            </Button>
          </div>
        </Alert>
      )}
      {hasRange && (
        <p className="muted" role="status">
          O intervalo de datas substitui o recorte mensal e pode atravessar
          meses.
        </p>
      )}
      {!shown.length ? (
        <EmptyState
          title="Nenhum resultado"
          description="Altere os filtros ou crie um lançamento."
        />
      ) : (
        <div className="list-card">
          {shown.map((item) => (
            <article className="transaction-row" key={item.id}>
              <div>
                <strong>{item.description}</strong>
                <span>
                  {profiles.find((profile) => profile.id === item.profileId)?.name ?? "Perfil indisponível"} · {item.categoryName} ·{" "}
                  {item.dueDate.split("-").reverse().join("/")} ·{" "}
                  {item.kind === "installment"
                    ? `${item.installmentCurrent}/${item.installmentTotal}`
                    : item.kind === "recurring"
                      ? "Recorrente"
                      : "À vista"}
                </span>
                {item.notes && <small>{item.notes}</small>}
              </div>
              <b
                className={item.type === "expense" ? "negative" : "positive"}
                aria-label={`${item.type === "expense" ? "Despesa" : "Receita"}: ${formatMoney(item.amountCents)}`}
              >
                {item.type === "expense" ? "−" : "+"} {formatMoney(item.amountCents)}
              </b>
              <div className="row-actions">
                {item.status === "pending" && (
                  <Button
                    size="compact"
                    onClick={(event) => {
                      settleTrigger.current = event.currentTarget;
                      setSettling(item);
                    }}
                  >
                    {item.type === "expense" ? "Pagar" : "Receber"}
                  </Button>
                )}
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => {
                    setEditing(item);
                    setOpen(true);
                  }}
                >
                  Editar
                </Button>
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={(event) => {
                    duplicateTrigger.current = event.currentTarget;
                    setDuplicateError("");
                    setDuplicating(item);
                  }}
                >
                  Duplicar
                </Button>
                <Button
                  size="compact"
                  variant="danger"
                  onClick={(event) => requestDelete(item, event.currentTarget)}
                >
                  Excluir
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <TransactionForm
        open={open}
        item={editing}
        prefill={editing ? undefined : prefill}
        ownerUid={ownerUid}
        categories={categories}
        profiles={profiles}
        defaultProfileId={selectedProfileId || profiles.find((profile) => profile.name.localeCompare("Principal", "pt-BR", { sensitivity: "base" }) === 0)?.id || profiles[0]?.id || ""}
        allItems={items}
        onClose={() => {
          setOpen(false);
          onPrefillUsed();
        }}
        onSaved={async () => {
          setOpen(false);
          onPrefillUsed();
          onMessage("Lançamento salvo.");
          try {
            await onChanged();
          } catch (refreshError) {
            onError((refreshError as Error).message);
          }
        }}
        onCategoriesChanged={onChanged}
      />
      <ConfirmModal
        open={Boolean(duplicating)}
        title="Duplicar lançamento"
        confirmLabel="Duplicar"
        busy={duplicateBusy}
        onClose={closeDuplicate}
        onConfirm={() => void duplicate()}
      >
        {duplicateError && <Alert type="error">{duplicateError}</Alert>}
        <p>
          Duplicar “{duplicating?.description}”? A cópia será criada como um
          lançamento à vista e pendente.
        </p>
      </ConfirmModal>
      <ConfirmModal
        open={Boolean(settling)}
        title={
          settling?.type === "expense"
            ? "Confirmar pagamento"
            : "Confirmar recebimento"
        }
        confirmLabel={
          settling?.type === "expense"
            ? "Marcar como pago"
            : "Marcar como recebido"
        }
        busy={settleBusy}
        onClose={closeSettle}
        onConfirm={() => void settle()}
      >
        <p>
          O lançamento “{settling?.description}” será marcado como{" "}
          {settling?.type === "expense" ? "pago" : "recebido"}.
        </p>
      </ConfirmModal>
      <ConfirmModal
        open={Boolean(deleting)}
        title="Excluir lançamento"
        confirmLabel="Excluir"
        danger
        busy={deleteBusy}
        onClose={closeDelete}
        onConfirm={() => void remove()}
      >
        <p>Confirme a exclusão deste lançamento.</p>
        {deleting?.seriesId && (
          <AccessibleSelect
            label="O que excluir"
            value={deleteScope}
            onChange={(value) => setDeleteScope(value as SeriesScope)}
            options={[
              { value: "single", label: "Somente esta ocorrência" },
              { value: "future", label: "Esta e ocorrências futuras" },
            ]}
          />
        )}
      </ConfirmModal>
    </section>
  );
}
