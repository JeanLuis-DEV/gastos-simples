import { Alert, Button, Input, Modal } from "@apps-simples/ui";
import { useEffect, useId, useRef, useState } from "react";
import { sortCategories } from "../../domain/categories";
import type { Category, TransactionType } from "../../domain/models";
import { addCategory } from "../../storage/database";

export function CategoryPicker({
  ownerUid,
  type,
  categories,
  value,
  onChange,
  onCategoriesChanged,
  invalid = false,
  describedBy,
}: {
  ownerUid: string;
  type: TransactionType;
  categories: Category[];
  value: string;
  onChange: (categoryId: string) => void;
  onCategoriesChanged: () => Promise<void>;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const labelId = useId();
  const valueId = useId();
  const errorId = useId();
  const available = sortCategories(
    categories.filter((category) => category.type === type),
  );
  const selected = available.find((category) => category.id === value);

  useEffect(() => {
    if (open) {
      const selectedIndex = available.findIndex(
        (category) => category.id === value,
      );
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
    if (!open) {
      setCreating(false);
      setName("");
      setError("");
    }
  }, [open, value, type]);

  const moveOptionFocus = (index: number) => {
    if (!available.length) return;
    const nextIndex = (index + available.length) % available.length;
    setActiveIndex(nextIndex);
    optionRefs.current[nextIndex]?.focus();
  };

  const select = (categoryId: string) => {
    onChange(categoryId);
    setOpen(false);
  };

  const create = async () => {
    if (busy) return;
    try {
      setBusy(true);
      setError("");
      const category = await addCategory(ownerUid, name, type);
      await onCategoriesChanged();
      onChange(category.id);
      setOpen(false);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="category-picker">
        <span id={labelId} className="category-picker__label">Categoria</span>
        <button
          ref={triggerRef}
          type="button"
          className="category-picker__trigger"
          aria-labelledby={`${labelId} ${valueId}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onClick={() => setOpen(true)}
        >
          <span id={valueId}>{selected?.name ?? "Selecione uma categoria"}</span>
          <span className="category-picker__chevron" aria-hidden="true" />
        </button>
      </div>
      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title="Selecionar categoria"
      >
        {error && <Alert type="error"><span id={errorId}>{error}</span></Alert>}
        {!creating ? (
          <>
            <div className="category-options" role="listbox" aria-label="Categorias disponíveis">
              {available.map((category, index) => (
                <button
                  key={category.id}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  type="button"
                  role="option"
                  aria-selected={category.id === value}
                  tabIndex={activeIndex === index ? 0 : -1}
                  className="category-option"
                  onFocus={() => setActiveIndex(index)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      moveOptionFocus(index + 1);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      moveOptionFocus(index - 1);
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      moveOptionFocus(0);
                    } else if (event.key === "End") {
                      event.preventDefault();
                      moveOptionFocus(available.length - 1);
                    } else if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      select(category.id);
                    }
                  }}
                  onClick={() => select(category.id)}
                >
                  <span>{category.name}</span>
                  {category.id === value && <strong aria-hidden="true">Selecionada</strong>}
                </button>
              ))}
            </div>
            <Button variant="secondary" onClick={() => setCreating(true)}>
              Adicionar categoria manualmente
            </Button>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void create();
            }}
          >
            <Input
              label="Nome da nova categoria"
              maxLength={40}
              required
              autoFocus
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <div className="button-row category-create-actions">
              <Button type="button" variant="secondary" onClick={() => setCreating(false)} disabled={busy}>
                Voltar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Adicionando…" : "Adicionar e selecionar"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
