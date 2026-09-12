import { Button, Card } from "@apps-simples/ui";
import { useEffect, useState } from "react";
import { calculate } from "../../domain/calculator";
import { parseMoneyToCents } from "../../domain/money";
import { calculatorRepository } from "../../storage/database";
import type { TransactionPrefill } from "./TransactionForm";
import type { FeedbackProps } from "./types";

function formatCalculatorResult(value: string) {
  const match = value.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return value;
  const [, sign, integer, fraction] = match;
  const grouped = integer!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped}${fraction ? `,${fraction}` : ""}`;
}

const expressionOperatorPattern = /[+\-−×÷*/]/;
const trailingOperatorPattern = /[+\-−×÷*/]$/;
const calculatorOperatorKeys = new Set(["+", "−", "×", "÷"]);
const normalizeOperatorKey = (key: string) => (key === "−" ? "-" : key);

export function CalculatorView({
  ownerUid,
  onError,
  onMessage,
  onUseValue,
}: { ownerUid: string; onUseValue: (value: TransactionPrefill) => void } & Pick<
  FeedbackProps,
  "onError" | "onMessage"
>) {
  const [expression, setExpression] = useState(""),
    [result, setResult] = useState(""),
    [history, setHistory] = useState<
      Array<{ id: string; expression: string; result: string }>
    >([]);
  const displayedResult = result ? formatCalculatorResult(result) : "0";
  let usableAmountCents: number | undefined;
  try {
    const parsed = parseMoneyToCents(result);
    if (parsed > 0) usableAmountCents = parsed;
  } catch {
    // Resultados vazios, negativos ou com mais de duas casas não são monetários.
  }
  const refresh = () =>
    void calculatorRepository
      .list(ownerUid)
      .then((v) =>
        setHistory(
          v.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20),
        ),
      )
      .catch((e) => onError((e as Error).message));
  useEffect(refresh, [ownerUid]);
  const evaluate = async () => {
    try {
      const value = calculate(expression);
      setResult(value);
      await calculatorRepository.put({
        id: crypto.randomUUID(),
        ownerUid,
        expression,
        result: value,
        createdAt: new Date().toISOString(),
      });
      refresh();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(formatCalculatorResult(result));
      else throw new Error();
      onMessage("Resultado copiado.");
    } catch {
      try {
        const field = document.createElement("textarea");
        field.value = formatCalculatorResult(result);
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.append(field);
        field.select();
        const copied = document.execCommand("copy");
        field.remove();
        if (!copied) throw new Error();
        onMessage("Resultado copiado pelo modo compatível.");
      } catch {
        onError(
          "Não foi possível copiar. Selecione o resultado e copie manualmente.",
        );
      }
    }
  };
  const useValue = () => {
    if (usableAmountCents === undefined) {
      onError("Use um resultado positivo com até duas casas decimais.");
      return;
    }
    onUseValue({
      amountCents: usableAmountCents,
      notes: expression ? `Resultado de ${expression}` : undefined,
    });
  };
  const appendKey = (key: string) => {
    if (result) {
      if (calculatorOperatorKeys.has(key)) {
        setExpression(
          `${formatCalculatorResult(result)}${normalizeOperatorKey(key)}`,
        );
      } else {
        setExpression(key === "," ? "0," : key);
      }
      setResult("");
      return;
    }
    setResult("");
    setExpression((current) => {
      if (key === ",") {
        const operand = current.split(expressionOperatorPattern).at(-1) ?? "";
        if (operand.includes(",") || operand.includes(".")) return current;
        return `${current}${operand ? "" : "0"},`;
      }
      if (calculatorOperatorKeys.has(key)) {
        if (!current) return key === "−" ? "-" : current;
        const operator = normalizeOperatorKey(key);
        return trailingOperatorPattern.test(current)
          ? `${current.slice(0, -1)}${operator}`
          : `${current}${operator}`;
      }
      return `${current}${key}`;
    });
  };
  const toggleSign = () => {
    setResult("");
    setExpression((current) => {
      if (!current) return "-";
      const match = current.match(/\d+(?:[.,]\d*)?$/);
      if (!match || match.index === undefined) return current;
      const start = match.index;
      const before = current[start - 1];
      const precededByMinus = before === "-" || before === "−";
      if (
        precededByMinus &&
        (start === 1 || expressionOperatorPattern.test(current[start - 2] ?? ""))
      )
        return `${current.slice(0, start - 1)}${current.slice(start)}`;
      if (precededByMinus)
        return `${current.slice(0, start - 1)}+${current.slice(start)}`;
      if (before === "+")
        return `${current.slice(0, start - 1)}-${current.slice(start)}`;
      return `${current.slice(0, start)}-${current.slice(start)}`;
    });
  };
  const keypad = [
    ["C", "±", "backspace", "÷"],
    ["7", "8", "9", "×"],
    ["4", "5", "6", "−"],
    ["1", "2", "3", "+"],
    ["0", ",", "="],
  ];
  return (
    <section aria-labelledby="calculator-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Cálculo exato</p>
          <h1 id="calculator-title">Calculadora financeira</h1>
        </div>
      </div>
      <div className="calculator-layout">
        <Card className="calculator-card">
          <label className="native-field">
            Expressão
            <input
              aria-label="Expressão"
              inputMode="decimal"
              placeholder="Ex.: 12,50 + 3 × 2"
              value={expression}
              onChange={(e) => {
                setExpression(e.target.value);
                setResult("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void evaluate();
              }}
            />
          </label>
          <div
            className="calculator-result"
            tabIndex={0}
            aria-live="polite"
            aria-label={`Resultado: ${displayedResult}`}
          >
            {displayedResult}
          </div>
          <div className="calculator-keypad" aria-label="Teclado da calculadora">
            {keypad.flat().map((key) => {
              const isOperator = ["÷", "×", "−", "+", "="].includes(key);
              const label = key === "backspace" ? "Apagar último caractere" : key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`${isOperator ? "calculator-key calculator-key--operator" : "calculator-key"}${key === "0" ? " calculator-key--zero" : ""}`}
                  aria-label={label}
                  onClick={() => {
                    if (key === "C") {
                      setExpression("");
                      setResult("");
                    } else if (key === "±") toggleSign();
                    else if (key === "backspace") {
                      setResult("");
                      setExpression((current) => current.slice(0, -1));
                    }
                    else if (key === "=") void evaluate();
                    else appendKey(key);
                  }}
                >
                  {key === "backspace" ? "⌫" : key}
                </button>
              );
            })}
          </div>
          <div className="calculator-actions">
            <Button variant="secondary" disabled={!result} onClick={() => void copy()}>
              Copiar resultado
            </Button>
            <Button disabled={usableAmountCents === undefined} onClick={useValue}>
              Usar no lançamento
            </Button>
          </div>
          {result && usableAmountCents === undefined && (
            <p className="muted" role="status">
              Para usar no lançamento, o resultado deve ser positivo e ter no
              máximo duas casas decimais.
            </p>
          )}
        </Card>
        <Card className="calculator-history">
          <h2>Histórico</h2>
          {history.length ? (
            <ul className="history-list">
              {history.map((h) => (
                <li key={h.id}>
                  <button
                    onClick={() => {
                      setExpression(h.expression);
                      setResult(h.result);
                    }}
                  >
                    <span>{h.expression}</span>
                    <strong>{formatCalculatorResult(h.result)}</strong>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nenhum cálculo ainda.</p>
          )}
        </Card>
      </div>
    </section>
  );
}
