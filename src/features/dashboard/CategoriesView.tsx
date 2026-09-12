import { Button, Card, Input } from "@apps-simples/ui";
import { useState } from "react";
import { sortCategories } from "../../domain/categories";
import type { Category, TransactionType } from "../../domain/models";
import { addCategory, deleteCategory } from "../../storage/database";
import { ConfirmModal } from "./ConfirmModal";
import { AccessibleSelect } from "./AccessibleSelect";
import type { DataProps } from "./types";
export function CategoriesView({
  ownerUid,
  categories,
  items,
  onChanged,
  onError,
  onMessage,
}: DataProps) {
  const [name, setName] = useState(""),
    [type, setType] = useState<TransactionType>("expense"),
    [deleting, setDeleting] = useState<Category>(),
    [busy, setBusy] = useState(false);
  const add = async () => {
    if (busy) return;
    try {
      setBusy(true);
      await addCategory(ownerUid, name, type);
      setName("");
      onMessage("Categoria criada.");
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!deleting || busy) return;
    try {
      setBusy(true);
      await deleteCategory(ownerUid, deleting.id);
      setDeleting(undefined);
      onMessage("Categoria excluída.");
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="categories-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Organização</p>
          <h1 id="categories-title">Categorias</h1>
        </div>
      </div>
      <Card>
        <h2>Nova categoria</h2>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <AccessibleSelect
            label="Tipo"
            value={type}
            onChange={(value) => setType(value as TransactionType)}
            options={[
              { value: "expense", label: "Despesa" },
              { value: "income", label: "Receita" },
            ]}
          />
          <Input
            label="Nome"
            required
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            {busy ? "Adicionando…" : "Adicionar"}
          </Button>
        </form>
      </Card>
      <div className="two-columns">
        {(["expense", "income"] as TransactionType[]).map((t) => (
          <Card key={t}>
            <h2>{t === "expense" ? "Despesas" : "Receitas"}</h2>
            <ul className="category-list">
              {sortCategories(categories.filter((c) => c.type === t))
                .map((c) => {
                  const inUse = items.some(
                    (item) => item.categoryId === c.id && item.isDeleted !== true,
                  );
                  const reasonId = `category-protection-${c.id}`;
                  return (
                  <li key={c.id}>
                    <span>
                      {c.name}
                      {c.isDefault && (
                        <small id={reasonId}>Categoria padrão protegida.</small>
                      )}
                      {inUse && (
                        <small id={reasonId}>
                          Em uso. Altere a categoria dos lançamentos ativos antes de excluí-la.
                        </small>
                      )}
                    </span>
                    {!c.isDefault && (
                      <Button
                        size="compact"
                        variant="danger"
                        disabled={inUse}
                        aria-describedby={inUse ? reasonId : undefined}
                        onClick={() => setDeleting(c)}
                      >
                        Excluir
                      </Button>
                    )}
                  </li>
                  );
                })}
            </ul>
          </Card>
        ))}
      </div>
      <ConfirmModal
        open={Boolean(deleting)}
        title="Excluir categoria"
        confirmLabel="Excluir"
        danger
        busy={busy}
        onClose={() => setDeleting(undefined)}
        onConfirm={() => void remove()}
      >
        <p>
          Excluir a categoria “{deleting?.name}”? Esta ação não pode ser
          desfeita.
        </p>
      </ConfirmModal>
    </section>
  );
}
