import { Card, EmptyState } from "@apps-simples/ui";
import { useState } from "react";
import { localCivilDate } from "../../domain/dates";
import { formatMoney, monthlyTotals } from "../../domain/money";
import type { Transaction } from "../../domain/models";
import { InfoPopover } from "./InfoPopover";

type FinancialCardLabel =
  | "Saldo previsto"
  | "Saldo realizado"
  | "A pagar"
  | "A receber"
  | "Receitas"
  | "Despesas";

export function financialValueTone(
  label: FinancialCardLabel,
  value: number,
): "positive" | "negative" | "neutral" {
  if (label === "A pagar" || label === "Despesas") return "negative";
  if (label === "A receber" || label === "Receitas") return "positive";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

export function DashboardView({
  items,
  totals,
}: {
  items: Transaction[];
  totals: ReturnType<typeof monthlyTotals>;
}) {
  const [openInfo, setOpenInfo] = useState<"planned" | "realized">();
  const today = localCivilDate();
  const pending = items.filter((i) => i.status === "pending");
  const overdue = pending.filter((i) => i.dueDate < today);
  const upcoming = pending
    .filter((i) => i.dueDate >= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 5);
  return (
    <section aria-labelledby="dashboard-title">
      <h1 id="dashboard-title" className="sr-only">
        Resumo financeiro mensal
      </h1>
      <div className="summary-grid">
        {([
          ["Saldo previsto", totals.plannedBalance],
          ["Saldo realizado", totals.realizedBalance],
          ["A pagar", totals.toPay],
          ["A receber", totals.toReceive],
          ["Despesas", totals.expensePlanned],
          ["Receitas", totals.incomePlanned],
        ] satisfies Array<[FinancialCardLabel, number]>).map(([label, value]) => (
          <Card key={label}>
            <span className="summary-label-row">
              <span className="summary-label">{label}</span>
              {label === "Saldo previsto" && <InfoPopover label="Entenda o saldo previsto" open={openInfo === "planned"} onOpenChange={(open) => setOpenInfo(open ? "planned" : undefined)}>Receitas do mês menos despesas do mês, incluindo valores já realizados e valores ainda pendentes.</InfoPopover>}
              {label === "Saldo realizado" && <InfoPopover label="Entenda o saldo realizado" align="end" open={openInfo === "realized"} onOpenChange={(open) => setOpenInfo(open ? "realized" : undefined)}>Receitas já recebidas menos despesas já pagas no mês. Valores pendentes não entram neste saldo.</InfoPopover>}
            </span>
            <strong
              className={`summary-value ${financialValueTone(label, value)}`}
              data-tone={financialValueTone(label, value)}
            >
              {formatMoney(value)}
            </strong>
          </Card>
        ))}
      </div>
      {!items.length ? (
        <EmptyState
          title="Mês sem lançamentos"
          description="Adicione uma receita ou despesa para começar."
        />
      ) : (
        <div className="two-columns">
          <Card>
            <h2>Próximos</h2>
            <List items={upcoming} empty="Nenhum lançamento próximo." />
          </Card>
          <Card>
            <h2>Atrasados</h2>
            <List items={overdue} empty="Tudo em dia." />
          </Card>
        </div>
      )}
    </section>
  );
}
function List({ items, empty }: { items: Transaction[]; empty: string }) {
  return items.length ? (
    <ul className="transaction-list">
      {items.map((i) => (
        <li key={i.id}>
          <span>
            <strong>{i.description}</strong>
            <small>
              {i.dueDate.split("-").reverse().join("/")} · {i.categoryName}
            </small>
          </span>
          <b className={i.type === "expense" ? "negative" : "positive"}>
            {i.type === "expense" ? "−" : "+"} {formatMoney(i.amountCents)}
          </b>
        </li>
      ))}
    </ul>
  ) : (
    <p className="muted">{empty}</p>
  );
}
