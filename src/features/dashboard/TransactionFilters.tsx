import { Button, Input } from "@apps-simples/ui";
import { useId } from "react";
import { sortCategories } from "../../domain/categories";
import type {
  Category,
  TransactionFilters as Filters,
  TransactionKind,
  TransactionStatus,
  TransactionType,
} from "../../domain/models";
import { AccessibleSelect } from "./AccessibleSelect";
export function TransactionFilters({
  filters,
  categories,
  onChange,
}: {
  filters: Filters;
  categories: Category[];
  onChange: (filters: Filters) => void;
}) {
  const availableCategories = sortCategories(
    filters.type
      ? categories.filter((category) => category.type === filters.type)
      : categories,
  );
  const invalidRange = Boolean(
    filters.from && filters.to && filters.from > filters.to,
  );
  const rangeErrorId = useId();
  return (
    <details className="filters">
      <summary>Filtros</summary>
      <div className="filter-grid">
        <AccessibleSelect
          label="Tipo"
          value={filters.type ?? ""}
          onChange={(value) => {
            const type = (value || undefined) as
              | TransactionType
              | undefined;
            const selectedCategory = categories.find(
              (category) => category.id === filters.categoryId,
            );
            onChange({
              ...filters,
              type,
              categoryId:
                type && selectedCategory?.type !== type
                  ? undefined
                  : filters.categoryId,
            });
          }}
          options={[
            { value: "", label: "Todos" },
            { value: "expense", label: "Despesa" },
            { value: "income", label: "Receita" },
          ]}
        />
        <AccessibleSelect
          label="Categoria"
          value={filters.categoryId ?? ""}
          onChange={(value) =>
            onChange({ ...filters, categoryId: value || undefined })
          }
          options={[
            { value: "", label: "Todas" },
            ...availableCategories.map((category) => ({
              value: category.id,
              label: category.name,
            })),
          ]}
        />
        <AccessibleSelect
          label="Forma"
          value={filters.kind ?? ""}
          onChange={(value) =>
            onChange({
              ...filters,
              kind: (value || undefined) as
                | TransactionKind
                | undefined,
            })
          }
          options={[
            { value: "", label: "Todas" },
            { value: "single", label: "À vista" },
            { value: "recurring", label: "Recorrente" },
            { value: "installment", label: "Parcelado" },
          ]}
        />
        <AccessibleSelect
          label="Situação"
          value={filters.status ?? ""}
          onChange={(value) =>
            onChange({
              ...filters,
              status: (value || undefined) as
                | TransactionStatus
                | undefined,
            })
          }
          options={[
            { value: "", label: "Todas" },
            { value: "pending", label: "Pendente" },
            { value: "paid", label: "Pago" },
            { value: "received", label: "Recebido" },
          ]}
        />
        <Input
          type="date"
          label="De"
          aria-invalid={invalidRange}
          aria-describedby={invalidRange ? rangeErrorId : undefined}
          value={filters.from ?? ""}
          onChange={(e) =>
            onChange({ ...filters, from: e.target.value || undefined })
          }
        />
        <Input
          type="date"
          label="Até"
          aria-invalid={invalidRange}
          aria-describedby={invalidRange ? rangeErrorId : undefined}
          value={filters.to ?? ""}
          onChange={(e) =>
            onChange({ ...filters, to: e.target.value || undefined })
          }
        />
      </div>
      {invalidRange && (
        <p id={rangeErrorId} className="field-error" role="alert">
          A data inicial deve ser anterior ou igual à data final.
        </p>
      )}
      <Button variant="ghost" size="compact" onClick={() => onChange({})}>
        Limpar todos os filtros
      </Button>
    </details>
  );
}
