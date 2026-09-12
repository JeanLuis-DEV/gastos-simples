import { describe, expect, it } from "vitest";
import { calculate } from "./calculator";
import { sortCategories } from "./categories";
import { addMonthsClamped, localCivilDate, localCivilMonth } from "./dates";
import { mapMercadoPagoStatus } from "./entitlement";
import {
  formatCentsForInput,
  maskMoneyDigits,
  monthlyTotals,
  parseMoneyToCents,
} from "./money";
import { DEFAULT_CATEGORIES, type Transaction } from "./models";
import {
  createTransactions,
  filterTransactions,
  markSettled,
  recurringOccurrenceForMonth,
  restructureTransactionSeries,
  selectSeriesItems,
  transactionsForView,
  updateSeriesItems,
} from "./transactions";

const base = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: "1",
  ownerUid: "u1",
  profileId: "profile:principal:u1",
  occurrenceKey: "single:1",
  description: "Conta",
  amountCents: 1000,
  type: "expense",
  status: "pending",
  dueDate: "2028-01-31",
  categoryId: "c1",
  categoryName: "Casa",
  notes: "",
  kind: "single",
  createdAt: "2028-01-01T00:00:00Z",
  updatedAt: "2028-01-01T00:00:00Z",
  ...overrides,
});

describe("ordenação de categorias", () => {
  it("ordena em português de forma determinística sem mutar a entrada", () => {
    const input = [
      { id: "3", ownerUid: "u1", name: "Úteis", type: "expense", isDefault: false },
      { id: "2", ownerUid: "u1", name: "alimentação", type: "expense", isDefault: false },
      { id: "1", ownerUid: "u1", name: "Água", type: "expense", isDefault: false },
    ] satisfies import("./models").Category[];
    expect(sortCategories(input).map(({ name }) => name)).toEqual([
      "Água",
      "alimentação",
      "Úteis",
    ]);
    expect(input.map(({ id }) => id)).toEqual(["3", "2", "1"]);
  });
});

describe("dinheiro e totais", () => {
  it("converte decimais para centavos sem ponto flutuante", () => {
    expect(parseMoneyToCents("1,99")).toBe(199);
    expect(parseMoneyToCents("1000.01")).toBe(100001);
  });
  it("aplica a máscara monetária brasileira por dígitos", () => {
    expect(maskMoneyDigits("1")).toBe("0,01");
    expect(maskMoneyDigits("123")).toBe("1,23");
    expect(maskMoneyDigits("480000")).toBe("4.800,00");
    expect(maskMoneyDigits("")).toBe("");
  });
  it("formata edição em centavos e aceita colagens brasileiras", () => {
    expect(formatCentsForInput(480000)).toBe("4.800,00");
    expect(parseMoneyToCents("4.800,00")).toBe(480000);
    expect(parseMoneyToCents("4800,00")).toBe(480000);
    expect(parseMoneyToCents("4800")).toBe(480000);
    expect(parseMoneyToCents("4.800")).toBe(480000);
  });
  it("calcula previsto e realizado", () => {
    const result = monthlyTotals([
      base({ type: "income", status: "received", amountCents: 5000 }),
      base({ id: "2", status: "paid", amountCents: 1200 }),
    ]);
    expect(result.plannedBalance).toBe(3800);
    expect(result.realizedBalance).toBe(3800);
    expect(result.toPay).toBe(0);
  });
});

describe("datas, parcelas e recorrências", () => {
  it.each([
    ["2027-01-31", 1, "2027-02-28"],
    ["2028-01-31", 1, "2028-02-29"],
    ["2027-01-30", 1, "2027-02-28"],
    ["2027-03-31", 1, "2027-04-30"],
  ])("ajusta %s em um mês para %s", (date, delta, expected) =>
    expect(addMonthsClamped(date, delta as number)).toBe(expected),
  );
  it("cria de 2 a 999 parcelas com datas válidas", () => {
    const items = createTransactions({
      ...base(),
      kind: "installment",
      installments: 3,
    });
    expect(items.map((i) => i.dueDate)).toEqual([
      "2028-01-31",
      "2028-02-29",
      "2028-03-31",
    ]);
    expect(items[2]?.installmentCurrent).toBe(3);
  });
  it("materializa recorrência mensal sem duplicar e preserva edição individual", () => {
    const first = createTransactions({ ...base(), kind: "recurring" })[0]!;
    const feb = recurringOccurrenceForMonth([first], "2028-02")!;
    const edited = { ...feb, amountCents: 1234 };
    expect(
      recurringOccurrenceForMonth([first, edited], "2028-02"),
    ).toBeUndefined();
    expect(first.amountCents).toBe(1000);
    expect(edited.dueDate).toBe("2028-02-29");
  });
  it("rejeita parcelamento fora do limite", () =>
    expect(() =>
      createTransactions({
        ...base(),
        kind: "installment",
        installments: 1000,
      }),
    ).toThrow(/2 a 999/));
  it.each([
    [2028, 1, 28],
    [2028, 1, 29],
    [2028, 2, 30],
    [2028, 2, 31],
  ])("preserva data civil local em %i-%i-%i", (year, month, day) => {
    const date = new Date(year, month, day, 23, 59, 59);
    expect(localCivilDate(date)).toBe(
      `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
    expect(localCivilMonth(date)).toBe(
      `${year}-${String(month + 1).padStart(2, "0")}`,
    );
  });
  it("não converte o calendário local para o dia UTC seguinte", () => {
    const localLate = new Date(2028, 0, 31, 23, 30);
    expect(localCivilDate(localLate)).toBe("2028-01-31");
  });
  it("edita e seleciona somente ocorrências futuras sem alterar quitadas anteriores", () => {
    const series = [
      base({
        id: "a",
        seriesId: "s",
        kind: "recurring",
        dueDate: "2028-01-01",
        status: "paid",
      }),
      base({
        id: "b",
        seriesId: "s",
        kind: "recurring",
        dueDate: "2028-02-01",
      }),
      base({
        id: "c",
        seriesId: "s",
        kind: "recurring",
        dueDate: "2028-03-01",
      }),
    ];
    expect(
      selectSeriesItems(series, series[1]!, "future").map((i) => i.id),
    ).toEqual(["b", "c"]);
    const changed = updateSeriesItems(series, series[1]!, "future", {
      amountCents: 2000,
    });
    expect(changed.map((i) => i.amountCents)).toEqual([1000, 2000, 2000]);
  });
  it("move a ocorrência e as futuras preservando o espaçamento mensal", () => {
    const series = [
      base({
        id: "a",
        seriesId: "s",
        kind: "installment",
        dueDate: "2028-01-31",
      }),
      base({
        id: "b",
        seriesId: "s",
        kind: "installment",
        dueDate: "2028-02-29",
      }),
      base({
        id: "c",
        seriesId: "s",
        kind: "installment",
        dueDate: "2028-03-31",
      }),
    ];
    expect(
      updateSeriesItems(series, series[1]!, "future", {
        dueDate: "2028-02-28",
      }).map((i) => i.dueDate),
    ).toEqual(["2028-01-31", "2028-02-28", "2028-03-28"]);
  });
  it("preserva a quitação com o estado compatível ao trocar o tipo", () => {
    const paidExpense = base({ status: "paid" });
    expect(
      updateSeriesItems([paidExpense], paidExpense, "single", {
        type: "income",
      })[0]?.status,
    ).toBe("received");
  });
});

describe("conversão da forma de lançamentos", () => {
  const draft = (
    kind: Transaction["kind"],
    installments?: number,
  ) => ({
    ownerUid: "u1",
    profileId: "profile:principal:u1",
    type: "expense" as const,
    description: "Convertida",
    amountCents: 2500,
    dueDate: "2028-02-15",
    categoryId: "c1",
    categoryName: "Casa",
    notes: "preservada",
    kind,
    installments,
  });
  const recurring = [
    base({ id: "r1", seriesId: "rec", occurrenceKey: "rec:2028-01", kind: "recurring", dueDate: "2028-01-10", status: "paid" }),
    base({ id: "r2", seriesId: "rec", occurrenceKey: "rec:2028-02", kind: "recurring", dueDate: "2028-02-10" }),
    base({ id: "r3", seriesId: "rec", occurrenceKey: "rec:2028-03", kind: "recurring", dueDate: "2028-03-10" }),
  ];

  it("converte recorrente em à vista, preserva anteriores e encerra a série", () => {
    const converted = restructureTransactionSeries(
      recurring,
      recurring[1]!,
      draft("single"),
      new Date("2028-02-01T00:00:00Z"),
    );
    expect(converted.find(({ id }) => id === "r1")?.isDeleted).not.toBe(true);
    expect(converted.find(({ id }) => id === "r1")?.seriesEndDate).toBe("2028-02-10");
    expect(converted.filter(({ id }) => ["r2", "r3"].includes(id)).every(({ isDeleted }) => isDeleted)).toBe(true);
    expect(converted.filter(({ isDeleted }) => !isDeleted).map(({ kind }) => kind)).toEqual(["recurring", "single"]);
    expect(recurringOccurrenceForMonth(converted, "2028-04")).toBeUndefined();
  });

  it("converte recorrente em parcelado sem duplicar ocorrências", () => {
    const converted = restructureTransactionSeries(recurring, recurring[1]!, draft("installment", 3));
    const activeInstallments = converted.filter((item) => item.kind === "installment" && !item.isDeleted);
    expect(activeInstallments.map((item) => item.installmentCurrent)).toEqual([1, 2, 3]);
    expect(new Set(converted.map(({ occurrenceKey }) => occurrenceKey)).size).toBe(converted.length);
  });

  it("converte à vista em recorrente e parcelado", () => {
    const single = base({ id: "single", occurrenceKey: "single:old", dueDate: "2028-02-10" });
    const recurringResult = restructureTransactionSeries([single], single, draft("recurring"));
    expect(recurringResult.find(({ id }) => id === "single")?.isDeleted).toBe(true);
    expect(recurringResult.find((item) => item.kind === "recurring" && !item.isDeleted)?.seriesId).toBeTruthy();
    const installmentResult = restructureTransactionSeries([single], single, draft("installment", 2));
    expect(installmentResult.filter((item) => item.kind === "installment" && !item.isDeleted)).toHaveLength(2);
  });

  it("converte parcelado em recorrente e à vista preservando a parcela anterior", () => {
    const installments = createTransactions({ ...draft("installment", 3), status: "pending" });
    const target = installments[1]!;
    const asRecurring = restructureTransactionSeries(installments, target, draft("recurring"));
    expect(asRecurring.find(({ id }) => id === installments[0]!.id)?.isDeleted).not.toBe(true);
    expect(asRecurring.find((item) => item.kind === "recurring" && !item.isDeleted)).toBeTruthy();
    const asSingle = restructureTransactionSeries(installments, target, draft("single"));
    expect(asSingle.filter((item) => item.kind === "single" && !item.isDeleted)).toHaveLength(1);
    expect(asSingle.filter((item) => item.kind === "installment" && !item.isDeleted)).toHaveLength(1);
  });

  it("preserva quitação compatível apenas na primeira nova ocorrência", () => {
    const paid = base({ status: "paid" });
    const converted = restructureTransactionSeries([paid], paid, {
      ...draft("installment", 2),
      type: "income",
    });
    const created = converted.filter((item) => item.kind === "installment");
    expect(created.map(({ status }) => status)).toEqual(["received", "pending"]);
  });
});

describe("filtros e quitação", () => {
  const items = [
    base(),
    base({
      id: "2",
      type: "income",
      categoryId: "c2",
      kind: "recurring",
      dueDate: "2028-02-01",
    }),
  ];
  it("combina tipo, categoria, forma, situação e datas", () =>
    expect(
      filterTransactions(items, {
        type: "income",
        categoryId: "c2",
        kind: "recurring",
        status: "pending",
        from: "2028-02-01",
        to: "2028-02-28",
      }),
    ).toHaveLength(1));
  it("mantém o mês normal, atravessa meses por intervalo e volta ao mês ao limpar", () => {
    expect(transactionsForView(items, "2028-01", {}).map((i) => i.id)).toEqual([
      "1",
    ]);
    expect(
      transactionsForView(items, "2028-01", {
        from: "2028-01-01",
        to: "2028-02-28",
      }),
    ).toHaveLength(2);
    expect(transactionsForView(items, "2028-01", {}).map((i) => i.id)).toEqual([
      "1",
    ]);
  });
  it("marca despesa paga e receita recebida sem alterar outra ocorrência", () => {
    expect(markSettled(items[0]!).status).toBe("paid");
    expect(markSettled(items[1]!).status).toBe("received");
    expect(items[0]!.status).toBe("pending");
  });
});

describe("calculadora decimal", () => {
  it("calcula subtrações binárias sem confundi-las com sinal negativo", () => {
    expect(calculate("100-15")).toBe("85");
    expect(calculate("2-1")).toBe("1");
    expect(calculate("10+10-15")).toBe("5");
    expect(calculate("10,5 - 2,25")).toBe("8.25");
    expect(calculate("2 - 5")).toBe("-3");
  });
  it("respeita precedência, negativos e decimais exatos", () => {
    expect(calculate("0,1 + 0,2 × 3")).toBe("0.7");
    expect(calculate("4.800,00 ÷ 2")).toBe("2400");
    expect(calculate("4.800 + 200")).toBe("5000");
    expect(calculate("-5 + 2")).toBe("-3");
    expect(calculate("10 × -2 + 25 ÷ 5")).toBe("-15");
    expect(calculate("20 - 3 × -2 + 8 ÷ 4")).toBe("28");
  });
  it("rejeita operandos ou tokens residuais", () => {
    expect(() => calculate("1 2")).toThrow("Expressão inválida.");
    expect(() => calculate("1 + 2 3")).toThrow("Expressão inválida.");
  });
  it("trata divisão por zero", () =>
    expect(() => calculate("10 ÷ 0")).toThrow(/dividir por zero/));
});

describe("estados Mercado Pago", () => {
  it.each([
    ["authorized", "active", true],
    ["pending", "pending", false],
    ["cancelled", "cancelled", false],
    ["paused", "paused", false],
    ["rejected", "rejected", false],
  ])("mapeia %s", (source, status, access) => {
    const value = mapMercadoPagoStatus(source);
    expect(value.status).toBe(status);
    expect(value.hasAccess).toBe(access);
  });
  it("expira por data", () =>
    expect(
      mapMercadoPagoStatus("authorized", new Date("2028-02-01"), "2028-01-01")
        .status,
    ).toBe("expired"));
});

describe("categorias oficiais", () => {
  it("preserva a lista completa do legado sem duplicatas por caixa", () => {
    expect(DEFAULT_CATEGORIES.map((c) => c.name)).toEqual([
      "Alimentação",
      "Transporte",
      "Moradia",
      "Saúde",
      "Educação",
      "Lazer",
      "Vestuário",
      "Serviços",
      "Contas e Taxas",
      "Salário",
      "Freelance",
      "Investimentos",
      "Vendas",
      "Aluguéis",
      "Rendimentos",
      "Bônus",
      "Reembolso",
      "Doações",
    ]);
    const keys = DEFAULT_CATEGORIES.map(
      (c) => `${c.type}:${c.name.toLocaleLowerCase("pt-BR")}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
