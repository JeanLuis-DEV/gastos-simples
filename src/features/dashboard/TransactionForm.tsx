import { Alert, Button, Input, Modal } from "@apps-simples/ui";
import { useEffect, useId, useMemo, useState } from "react";
import { sortCategories } from "../../domain/categories";
import { isValidCivilDate, localCivilDate } from "../../domain/dates";
import {
  formatCentsForInput,
  maskMoneyDigits,
  parseMoneyToCents,
} from "../../domain/money";
import type {
  Category,
  FinancialProfile,
  Transaction,
  TransactionKind,
  TransactionType,
} from "../../domain/models";
import {
  createTransactions,
  restructureTransactionSeries,
  selectSeriesItems,
  updateSeriesItems,
  type SeriesScope,
} from "../../domain/transactions";
import { transactionsRepository } from "../../storage/database";
import { CategoryPicker } from "./CategoryPicker";
import { ProfileSelect } from "./ProfileSelect";
import { AccessibleSelect } from "./AccessibleSelect";

export type TransactionPrefill = { amountCents: number; notes?: string };
type FormField =
  | "description"
  | "amount"
  | "dueDate"
  | "profile"
  | "category"
  | "installments"
  | "settled";
class FormError extends Error {
  constructor(
    message: string,
    readonly field?: FormField,
  ) {
    super(message);
  }
}
export function TransactionForm({
  open,
  item,
  prefill,
  ownerUid,
  categories,
  profiles = [],
  defaultProfileId = "",
  allItems,
  onClose,
  onSaved,
  onCategoriesChanged,
}: {
  open: boolean;
  item?: Transaction;
  prefill?: TransactionPrefill;
  ownerUid: string;
  categories: Category[];
  profiles?: FinancialProfile[];
  defaultProfileId?: string;
  allItems: Transaction[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onCategoriesChanged: () => Promise<void>;
}) {
  const [type, setType] = useState<TransactionType>("expense"),
    [description, setDescription] = useState(""),
    [amount, setAmount] = useState(""),
    [dueDate, setDueDate] = useState(localCivilDate()),
    [categoryId, setCategoryId] = useState(""),
    [profileId, setProfileId] = useState(""),
    [kind, setKind] = useState<TransactionKind>("single"),
    [installments, setInstallments] = useState(2),
    [notes, setNotes] = useState(""),
    [scope, setScope] = useState<SeriesScope>("single"),
    [settledConfirmed, setSettledConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState<{ message: string; field?: FormField }>();
  const formId = useId();
  const errorId = useId();
  useEffect(() => {
    setType(item?.type ?? "expense");
    setDescription(item?.description ?? "");
    setAmount(
      item
        ? formatCentsForInput(item.amountCents)
        : prefill
          ? formatCentsForInput(prefill.amountCents)
          : "",
    );
    setDueDate(item?.dueDate ?? localCivilDate());
    setCategoryId(item?.categoryId ?? "");
    setProfileId(item?.profileId ?? defaultProfileId);
    setKind(item?.kind ?? "single");
    setInstallments(item?.installmentTotal ?? 2);
    setNotes(item?.notes ?? prefill?.notes ?? "");
    setScope("single");
    setSettledConfirmed(false);
    setFormError(undefined);
  }, [item, prefill, open, defaultProfileId]);
  const available = useMemo(
    () => sortCategories(categories.filter((c) => c.type === type)),
    [categories, type],
  );
  useEffect(() => {
    if (!categoryId) setCategoryId(available[0]?.id ?? "");
  }, [available, categoryId]);
  const kindChanged = Boolean(item && kind !== item.kind);
  const editScope: SeriesScope = kindChanged ? "future" : scope;
  const selectedHasSettled = Boolean(
    item &&
      selectSeriesItems(allItems, item, editScope).some(
        (value) => value.status !== "pending",
      ),
  );
  const fieldHasError = (field: FormField) => formError?.field === field;
  const clearFieldError = (field: FormField) => {
    if (fieldHasError(field)) setFormError(undefined);
  };
  const save = async () => {
    if (busy) return;
    try {
      setBusy(true);
      setFormError(undefined);
      if (!description.trim()) throw new FormError("Informe a descrição.", "description");
      if (!isValidCivilDate(dueDate))
        throw new FormError("Informe uma data de vencimento válida.", "dueDate");
      const category = categories.find((c) => c.id === categoryId);
      if (!category || category.ownerUid !== ownerUid)
        throw new FormError("Selecione uma categoria.", "category");
      const profile = profiles.find((value) => value.id === profileId && value.ownerUid === ownerUid);
      if (!profile) throw new FormError("Selecione um perfil válido.", "profile");
      let amountCents: number;
      try {
        amountCents = parseMoneyToCents(amount);
      } catch (reason) {
        throw new FormError((reason as Error).message, "amount");
      }
      if (
        kind === "installment" &&
        (!Number.isInteger(installments) || installments < 2 || installments > 999)
      )
        throw new FormError(
          "Parcelamento deve ter de 2 a 999 parcelas.",
          "installments",
        );
      if (item) {
        if (selectedHasSettled && !settledConfirmed)
          throw new FormError(
            "Confirme a alteração dos lançamentos já quitados.",
            "settled",
          );
        const changes = {
          type,
          profileId,
          description: description.trim(),
          amountCents,
          dueDate,
          categoryId,
          categoryName: category.name,
          notes: notes.trim(),
        };
        if (kindChanged)
          await transactionsRepository.putMany(
            restructureTransactionSeries(allItems, item, {
              ownerUid,
              ...changes,
              kind,
              installments,
            }),
          );
        else {
          const selected = selectSeriesItems(allItems, item, scope);
          const updated = updateSeriesItems(allItems, item, scope, changes);
          const selectedIds = new Set(selected.map((value) => value.id));
          await transactionsRepository.putMany(
            updated.filter((value) => selectedIds.has(value.id)),
          );
        }
      } else
        await transactionsRepository.putMany(
          createTransactions({
            ownerUid,
            profileId,
            type,
            description,
            amountCents,
            status: "pending",
            dueDate,
            categoryId,
            categoryName: category.name,
            notes: notes.trim(),
            kind,
            installments,
          }),
        );
      await onSaved();
      setFormError(undefined);
    } catch (error) {
      setFormError({
        message: (error as Error).message,
        field: error instanceof FormError ? error.field : undefined,
      });
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (!busy) {
      setFormError(undefined);
      onClose();
    }
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title={item ? "Editar lançamento" : "Novo lançamento"}
      footer={
        <div className="button-row">
          <Button type="button" variant="secondary" onClick={close} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      }
    >
      {formError && (
        <Alert type="error">
          <span id={errorId}>{formError.message}</span>
        </Alert>
      )}
      <form
        id={formId}
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <AccessibleSelect
          label="Tipo"
          value={type}
          onChange={(value) => {
            setType(value as TransactionType);
            setCategoryId("");
          }}
          options={[
            { value: "expense", label: "Despesa" },
            { value: "income", label: "Receita" },
          ]}
        />
        <Input
          label="Descrição"
          required
          maxLength={80}
          aria-invalid={fieldHasError("description")}
          aria-describedby={fieldHasError("description") ? errorId : undefined}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            clearFieldError("description");
          }}
        />
        <Input
          label="Valor"
          required
          inputMode="numeric"
          prefix="R$"
          aria-invalid={fieldHasError("amount")}
          aria-describedby={fieldHasError("amount") ? errorId : undefined}
          value={amount}
          onChange={(e) => {
            try {
              setAmount(maskMoneyDigits(e.target.value));
              clearFieldError("amount");
            } catch (reason) {
              setFormError({ message: (reason as Error).message, field: "amount" });
            }
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text");
            try {
              const cents = parseMoneyToCents(pasted);
              event.preventDefault();
              setAmount(formatCentsForInput(cents));
              clearFieldError("amount");
            } catch (reason) {
              event.preventDefault();
              setFormError({ message: (reason as Error).message, field: "amount" });
            }
          }}
        />
        <Input
          label="Vencimento"
          type="date"
          required
          aria-invalid={fieldHasError("dueDate")}
          aria-describedby={fieldHasError("dueDate") ? errorId : undefined}
          value={dueDate}
          onChange={(e) => {
            setDueDate(e.target.value);
            clearFieldError("dueDate");
          }}
        />
        <ProfileSelect
          label="Perfil"
          profiles={profiles}
          value={profileId}
          onChange={(value) => {
            setProfileId(value);
            clearFieldError("profile");
          }}
          invalid={fieldHasError("profile")}
          describedBy={fieldHasError("profile") ? errorId : undefined}
        />
        <CategoryPicker
          ownerUid={ownerUid}
          type={type}
          categories={categories}
          value={categoryId}
          onChange={(value) => {
            setCategoryId(value);
            clearFieldError("category");
          }}
          onCategoriesChanged={onCategoriesChanged}
          invalid={fieldHasError("category")}
          describedBy={fieldHasError("category") ? errorId : undefined}
        />
        <AccessibleSelect
          label="Forma"
          value={kind}
          onChange={(value) => setKind(value as TransactionKind)}
          options={[
            { value: "single", label: "À vista" },
            { value: "recurring", label: "Recorrente mensal" },
            { value: "installment", label: "Parcelado" },
          ]}
        />
        {kind === "installment" && (!item || kindChanged) && (
          <Input
            label="Parcelas"
            type="number"
            min={2}
            max={999}
            aria-invalid={fieldHasError("installments")}
            aria-describedby={fieldHasError("installments") ? errorId : undefined}
            value={installments}
            onChange={(e) => {
              setInstallments(Number(e.target.value));
              clearFieldError("installments");
            }}
          />
        )}{" "}
        {item?.seriesId && !kindChanged && (
          <AccessibleSelect
            label="Aplicar edição"
            value={scope}
            onChange={(value) => setScope(value as SeriesScope)}
            options={[
              { value: "single", label: "Somente esta ocorrência" },
              { value: "future", label: "Esta e ocorrências futuras" },
            ]}
          />
        )}
        <label className="native-field">
          Observações
          <textarea
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </form>
      {kindChanged && (
        <Alert type="info">
          A mudança de forma será aplicada desta ocorrência em diante. As
          ocorrências anteriores serão preservadas.
        </Alert>
      )}
      {selectedHasSettled && (
        <Alert type="warning">
          <label className="check-field">
            <input
              type="checkbox"
              checked={settledConfirmed}
              aria-describedby={fieldHasError("settled") ? errorId : undefined}
              onChange={(e) => {
                setSettledConfirmed(e.target.checked);
                clearFieldError("settled");
              }}
            />{" "}
            Confirmo alterar os lançamentos já quitados incluídos nesta edição.
          </label>
        </Alert>
      )}
    </Modal>
  );
}
