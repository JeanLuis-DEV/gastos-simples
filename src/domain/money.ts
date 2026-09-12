export const MAX_MONEY_CENTS = 9_999_999_999_999;

export function formatCentsForInput(cents: number): string {
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > MAX_MONEY_CENTS)
    throw new Error("Valor fora do limite permitido.");
  const sign = cents < 0 ? "-" : "";
  const digits = String(Math.abs(cents)).padStart(3, "0");
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${whole},${digits.slice(-2)}`;
}

export function maskMoneyDigits(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!digits) return "";
  const cents = Number(digits);
  if (!Number.isSafeInteger(cents) || cents > MAX_MONEY_CENTS)
    throw new Error("Valor fora do limite permitido.");
  return formatCentsForInput(cents);
}

export function parseMoneyToCents(value: string): number {
  const normalized = value.trim().replace(/^R\$\s?/, "").replace(/\s/g, "");
  const brazilian = /^-?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$/.test(normalized);
  const plain = /^-?\d+(?:[.,]\d{1,2})?$/.test(normalized);
  if (!brazilian && !plain)
    throw new Error("Informe um valor válido com até 2 casas decimais.");
  const decimal = normalized.includes(",")
    ? normalized.replace(/\./g, "").replace(",", ".")
    : brazilian && normalized.includes(".")
      ? normalized.replace(/\./g, "")
    : normalized;
  const negative = decimal.startsWith("-");
  const [whole = "0", fraction = ""] = decimal.replace("-", "").split(".");
  const cents = (Number(whole) * 100 + Number(fraction.padEnd(2, "0"))) *
    (negative ? -1 : 1);
  if (!Number.isSafeInteger(cents))
    throw new Error("Valor fora do limite permitido.");
  if (Math.abs(cents) > MAX_MONEY_CENTS)
    throw new Error("Valor fora do limite permitido.");
  return cents;
}

export const formatMoney = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );

export function monthlyTotals(items: Transaction[]) {
  let incomePlanned = 0,
    expensePlanned = 0,
    incomeRealized = 0,
    expenseRealized = 0;
  for (const item of items) {
    if (item.type === "income") {
      incomePlanned += item.amountCents;
      if (item.status === "received") incomeRealized += item.amountCents;
    } else {
      expensePlanned += item.amountCents;
      if (item.status === "paid") expenseRealized += item.amountCents;
    }
  }
  return {
    incomePlanned,
    expensePlanned,
    incomeRealized,
    expenseRealized,
    plannedBalance: incomePlanned - expensePlanned,
    realizedBalance: incomeRealized - expenseRealized,
    toPay: expensePlanned - expenseRealized,
    toReceive: incomePlanned - incomeRealized,
  };
}

import type { Transaction } from "./models";
