import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoginView } from "../auth/LoginView";
import { CalculatorView } from "./CalculatorView";
import { CategoryPicker } from "./CategoryPicker";
import { DashboardApp } from "./DashboardApp";
import { DashboardView, financialValueTone } from "./DashboardView";
import { FinancialProfilesCard } from "./FinancialProfilesCard";
import { SettingsView } from "./SettingsView";
import { TransactionsView } from "./TransactionsView";
import { CategoriesView } from "./CategoriesView";
import { TransactionFilters } from "./TransactionFilters";
import { TransactionForm } from "./TransactionForm";
import { ReportModal } from "./ReportModal";
import {
  addCategory,
  addFinancialProfile,
  calculatorRepository,
  categoriesRepository,
  ensureFinancialProfiles,
  profilesRepository,
  transactionsRepository,
} from "../../storage/database";
import { monthlyTotals } from "../../domain/money";
import type { Category, Transaction, TransactionType } from "../../domain/models";

const transaction = (
  id: string,
  type: TransactionType = "expense",
  ownerUid = "flow-user",
): Transaction => ({
  id,
  ownerUid,
  profileId: `profile:principal:${ownerUid}`,
  occurrenceKey: `single:${id}`,
  description: type === "expense" ? "Conta de luz" : "Salário",
  amountCents: 10000,
  type,
  status: "pending",
  dueDate: "2028-01-10",
  categoryId: type === "expense" ? "utilities" : "salary",
  categoryName: type === "expense" ? "Casa" : "Salário",
  notes: "",
  kind: "single",
  createdAt: "2028-01-01T00:00:00.000Z",
  updatedAt: "2028-01-01T00:00:00.000Z",
});

const flowCategories: Category[] = [
  { id: "utilities", ownerUid: "flow-user", name: "Casa", type: "expense", isDefault: false },
  { id: "salary", ownerUid: "flow-user", name: "Salário", type: "income", isDefault: false },
];

describe("fluxos acessíveis da interface", () => {
  it("abre edição com valor em centavos corretamente mascarado", () => {
    render(
      <TransactionForm
        open
        ownerUid="money-user"
        item={{
          id: "transaction",
          ownerUid: "money-user",
          profileId: "profile:principal:money-user",
          occurrenceKey: "single:transaction",
          description: "Compra",
          amountCents: 480000,
          type: "expense",
          status: "pending",
          dueDate: "2028-01-01",
          categoryId: "food",
          categoryName: "Alimentação",
          notes: "",
          kind: "single",
          createdAt: "2028-01-01T00:00:00.000Z",
          updatedAt: "2028-01-01T00:00:00.000Z",
        }}
        categories={[{ id: "food", ownerUid: "money-user", name: "Alimentação", type: "expense", isDefault: true }]}
        allItems={[]}
        onClose={vi.fn()}
        onSaved={vi.fn(async () => {})}
        onCategoriesChanged={vi.fn(async () => {})}
      />,
    );
    const field = screen.getByRole("textbox", { name: "Valor" }) as HTMLInputElement;
    expect(field.value).toBe("4.800,00");
    fireEvent.change(field, { target: { value: "1" } });
    expect(field.value).toBe("0,01");
  });

  it("permite escolher nova forma durante a edição e explicita a reestruturação", () => {
    const ownerUid = "edit-kind-user";
    const profile = { id: "profile", ownerUid, name: "Principal", createdAt: "2028-01-01T00:00:00Z", updatedAt: "2028-01-01T00:00:00Z" };
    const category = { id: "category", ownerUid, name: "Casa", type: "expense" as const, isDefault: false };
    const item = { ...transaction("edit-kind", "expense", ownerUid), profileId: profile.id, categoryId: category.id, categoryName: category.name };
    render(
      <TransactionForm open ownerUid={ownerUid} item={item} profiles={[profile]} categories={[category]} allItems={[item]} onClose={vi.fn()} onSaved={vi.fn(async () => {})} onCategoriesChanged={vi.fn(async () => {})} />,
    );
    const kind = screen.getByRole("combobox", { name: "Forma À vista" });
    fireEvent.click(kind);
    fireEvent.click(screen.getByRole("option", { name: "Parcelado" }));
    expect(screen.getByRole("spinbutton", { name: "Parcelas" })).toBeTruthy();
    expect(screen.getByText(/aplicada desta ocorrência em diante/i)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /Aplicar edição/ })).toBeNull();
  });

  it("mantém erro de salvamento e dados somente dentro do modal de edição", async () => {
    const ownerUid = "edit-error-user";
    const profile = { id: "profile", ownerUid, name: "Principal", createdAt: "2028-01-01T00:00:00Z", updatedAt: "2028-01-01T00:00:00Z" };
    const category = { id: "category", ownerUid, name: "Casa", type: "expense" as const, isDefault: false };
    const item = { ...transaction("edit-error", "expense", ownerUid), profileId: profile.id, categoryId: category.id, categoryName: category.name };
    const putMany = vi.spyOn(transactionsRepository, "putMany").mockRejectedValueOnce(new Error("Falha simulada ao salvar."));
    render(
      <main className="app-main">
        <TransactionForm open ownerUid={ownerUid} item={item} profiles={[profile]} categories={[category]} allItems={[item]} onClose={vi.fn()} onSaved={vi.fn(async () => {})} onCategoriesChanged={vi.fn(async () => {})} />
      </main>,
    );
    const description = screen.getByRole("textbox", { name: "Descrição" }) as HTMLInputElement;
    fireEvent.change(description, { target: { value: "Descrição preservada" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    const dialog = screen.getByRole("dialog");
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Falha simulada ao salvar.");
    expect(description.value).toBe("Descrição preservada");
    expect(screen.getByRole("heading", { name: "Editar lançamento" })).toBeTruthy();
    expect(document.querySelector(".app-main > .as-alert")).toBeNull();
    putMany.mockRestore();
  });

  it("seleciona categoria pelo seletor acessível", () => {
    const onChange = vi.fn();
    render(
      <CategoryPicker
        ownerUid="picker-user"
        type="expense"
        categories={[
          { id: "food", ownerUid: "picker-user", name: "Alimentação", type: "expense", isDefault: true },
          { id: "salary", ownerUid: "picker-user", name: "Salário", type: "income", isDefault: true },
        ]}
        value="food"
        onChange={onChange}
        onCategoriesChanged={vi.fn(async () => {})}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Categoria Alimentação/ });
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(trigger);
    const option = screen.getByRole("option", { name: /Alimentação/ });
    expect(option.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith("food");
  });

  it("navega pelas categorias com o padrão de teclado de listbox", () => {
    const onChange = vi.fn();
    render(
      <CategoryPicker
        ownerUid="keyboard-picker-user"
        type="expense"
        categories={[
          { id: "food", ownerUid: "keyboard-picker-user", name: "Alimentação", type: "expense", isDefault: true },
          { id: "services", ownerUid: "keyboard-picker-user", name: "Serviços", type: "expense", isDefault: true },
        ]}
        value="food"
        onChange={onChange}
        onCategoriesChanged={vi.fn(async () => {})}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Categoria Alimentação/ }));
    const food = screen.getByRole("option", { name: /Alimentação/ });
    const services = screen.getByRole("option", { name: /Serviços/ });
    food.focus();
    fireEvent.keyDown(food, { key: "ArrowDown" });
    expect(document.activeElement).toBe(services);
    fireEvent.keyDown(services, { key: "Home" });
    expect(document.activeElement).toBe(food);
    fireEvent.keyDown(food, { key: "End" });
    expect(document.activeElement).toBe(services);
    fireEvent.keyDown(services, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("services");
  });

  it("associa o erro de intervalo aos dois campos de data", () => {
    render(
      <TransactionFilters
        filters={{ from: "2028-02-02", to: "2028-02-01" }}
        categories={[]}
        onChange={vi.fn()}
      />,
    );
    const from = screen.getByLabelText("De");
    const to = screen.getByLabelText("Até");
    const error = screen.getByRole("alert");
    expect(from.getAttribute("aria-invalid")).toBe("true");
    expect(to.getAttribute("aria-invalid")).toBe("true");
    expect(from.getAttribute("aria-describedby")).toBe(error.id);
    expect(to.getAttribute("aria-describedby")).toBe(error.id);
  });

  it("mantém o resumo sem cabeçalho visual e sem ação duplicada", () => {
    const item = {
      id: "summary-item",
      ownerUid: "summary-user",
      profileId: "profile:principal:summary-user",
      occurrenceKey: "single:summary-item",
      description: "Compra",
      amountCents: 100,
      type: "expense" as const,
      status: "pending" as const,
      dueDate: "2028-01-01",
      categoryId: "food",
      categoryName: "Alimentação",
      notes: "",
      kind: "single" as const,
      createdAt: "2028-01-01T00:00:00.000Z",
      updatedAt: "2028-01-01T00:00:00.000Z",
    };
    const { rerender } = render(
      <DashboardView
        items={[item]}
        totals={monthlyTotals([item])}
      />,
    );
    expect(screen.getByRole("heading", { name: "Resumo financeiro mensal" }).classList.contains("sr-only")).toBe(true);
    expect(screen.queryByText("Visão mensal")).toBeNull();
    expect(screen.queryByRole("button", { name: /lançamento/i })).toBeNull();
    expect(
      Array.from(document.querySelectorAll(".summary-label")).map(
        (element) => element.textContent,
      ),
    ).toEqual([
      "Saldo previsto",
      "Saldo realizado",
      "A pagar",
      "A receber",
      "Despesas",
      "Receitas",
    ]);
    const negativeBalance = screen
      .getByText("Saldo previsto")
      .closest(".as-card")
      ?.querySelector(".summary-value");
    expect(negativeBalance?.childNodes).toHaveLength(1);
    expect(negativeBalance?.textContent).toContain("R$");
    rerender(
      <DashboardView items={[]} totals={monthlyTotals([])} />,
    );
    expect(screen.queryByRole("button", { name: "Adicionar lançamento" })).toBeNull();
  });

  it.each([
    ["Saldo previsto", 1, "positive"],
    ["Saldo previsto", -1, "negative"],
    ["Saldo previsto", 0, "neutral"],
    ["Saldo realizado", 1, "positive"],
    ["Saldo realizado", -1, "negative"],
    ["Saldo realizado", 0, "neutral"],
    ["A pagar", 0, "negative"],
    ["A receber", 0, "positive"],
    ["Receitas", 0, "positive"],
    ["Despesas", 0, "negative"],
  ] as const)("aplica tom semântico a %s com valor %i", (label, value, tone) => {
    expect(financialValueTone(label, value)).toBe(tone);
  });

  it("vira o ano e oferece Ajustes no cabeçalho com menu de quatro itens", async () => {
    render(
      <DashboardApp
        user={{ uid: "dashboard-shell-user", displayName: "Usuário", email: "user@example.test", photoURL: null }}
        entitlement={{ status: "active", hasAccess: true }}
        onLogout={vi.fn()}
      />,
    );
    const month = screen.getByLabelText("Mês selecionado") as HTMLInputElement;
    fireEvent.change(month, { target: { value: "2028-12" } });
    fireEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    expect(month.value).toBe("2029-01");
    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    expect(month.value).toBe("2028-12");
    expect(screen.getByText("Gastos Simples")).toBeTruthy();
    expect(screen.getByText("Premium")).toBeTruthy();
    expect(screen.queryByText("GS")).toBeNull();
    expect(screen.queryByText("○")).toBeNull();
    expect(screen.queryByText("●")).toBeNull();
    expect(screen.getByRole("button", { name: "Resumo" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("button", { name: "Ajustes" })).toBeNull();
    for (const label of ["Resumo", "Lançamentos", "Categorias", "Calculadora"])
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    const settings = screen.getByRole("button", { name: "Abrir Ajustes" });
    expect(settings.getAttribute("title")).toBe("Ajustes");
    expect(settings.getAttribute("aria-pressed")).toBe("false");
    expect(settings.querySelectorAll("svg path")).toHaveLength(2);
    expect(settings.querySelector("svg path")?.hasAttribute("fill")).toBe(false);
    await waitFor(() =>
      expect(
        document.querySelector(
          ".global-profile-select .profile-select__label",
        )?.textContent,
      ).toBe("Perfil financeiro"),
    );
    fireEvent.click(settings);
    expect(await screen.findByRole("heading", { name: "Ajustes" })).toBeTruthy();
    expect(settings.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Resumo" }));
    expect(settings.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Resumo" }).getAttribute("aria-current")).toBe("page");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it.each([
    ["expense", "Pagar", "Confirmar pagamento", "Marcar como pago", "paid"],
    ["income", "Receber", "Confirmar recebimento", "Marcar como recebido", "received"],
  ] as const)("confirma conclusão de %s uma única vez", async (type, action, title, confirm, status) => {
    const item = transaction(`settle-${type}`, type);
    await transactionsRepository.put(item);
    const put = vi.spyOn(transactionsRepository, "put");
    render(
      <TransactionsView
        ownerUid="flow-user"
        items={[item]}
        categories={flowCategories}
        month="2028-01"
        onPrefillUsed={vi.fn()}
        onChanged={vi.fn(async () => {})}
        onError={vi.fn()}
        onMessage={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: action }));
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    const finalButton = screen.getByRole("button", { name: confirm });
    fireEvent.click(finalButton);
    fireEvent.click(finalButton);
    await waitFor(async () =>
      expect((await transactionsRepository.list("flow-user")).find((value) => value.id === item.id)?.status).toBe(status),
    );
    expect(put).toHaveBeenCalledTimes(1);
    put.mockRestore();
  });

  it.each(["Cancelar", "Escape"])("não conclui lançamento ao usar %s e devolve foco", async (action) => {
    const item = transaction(`cancel-${action}`);
    await transactionsRepository.put(item);
    render(
      <TransactionsView
        ownerUid="flow-user"
        items={[item]}
        categories={flowCategories}
        month="2028-01"
        onPrefillUsed={vi.fn()}
        onChanged={vi.fn(async () => {})}
        onError={vi.fn()}
        onMessage={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Pagar" });
    trigger.focus();
    fireEvent.click(trigger);
    if (action === "Cancelar")
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    else fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Confirmar pagamento" })).toBeNull());
    expect((await transactionsRepository.list("flow-user")).find((value) => value.id === item.id)?.status).toBe("pending");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("confirma duplicação, permite cancelar e bloqueia gravação dupla", async () => {
    const ownerUid = "duplicate-confirm-user";
    const item = transaction("duplicate-source", "expense", ownerUid);
    await transactionsRepository.put(item);
    const put = vi.spyOn(transactionsRepository, "put");
    render(
      <TransactionsView ownerUid={ownerUid} items={[item]} categories={[]} month="2028-01" onPrefillUsed={vi.fn()} onChanged={vi.fn(async () => {})} onError={vi.fn()} onMessage={vi.fn()} />,
    );
    const trigger = screen.getByRole("button", { name: "Duplicar" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByText(/cópia será criada como um lançamento à vista e pendente/i)).toBeTruthy();
    expect(await transactionsRepository.list(ownerUid)).toHaveLength(1);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "Duplicar" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(async () => expect(await transactionsRepository.list(ownerUid)).toHaveLength(2));
    expect(put).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    put.mockRestore();
  });

  it("mantém o modal de duplicação aberto quando a persistência falha", async () => {
    const item = transaction("duplicate-error", "expense", "duplicate-error-user");
    vi.spyOn(transactionsRepository, "put").mockRejectedValueOnce(new Error("Falha ao duplicar."));
    render(
      <TransactionsView ownerUid={item.ownerUid} items={[item]} categories={[]} month="2028-01" onPrefillUsed={vi.fn()} onChanged={vi.fn(async () => {})} onError={vi.fn()} onMessage={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Duplicar" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Duplicar" }));
    const dialog = screen.getByRole("dialog");
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Falha ao duplicar.");
    expect(within(dialog).getByRole("heading", { name: "Duplicar lançamento" })).toBeTruthy();
  });

  it("sempre solicita confirmação antes de excluir um lançamento individual", async () => {
    const item = transaction("mandatory-delete", "expense", "mandatory-delete-user");
    render(
      <TransactionsView ownerUid={item.ownerUid} items={[item]} categories={[]} month="2028-01" onPrefillUsed={vi.fn()} onChanged={vi.fn(async () => {})} onError={vi.fn()} onMessage={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    expect(screen.getByRole("heading", { name: "Excluir lançamento" })).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" })).toBeTruthy();
  });

  it("confirma ou cancela categoria livre e explica proteção por uso ativo", async () => {
    const ownerUid = "category-ui-user";
    const free = { id: "free", ownerUid, name: "Livre", type: "expense", isDefault: false } as const;
    const used = { id: "used", ownerUid, name: "Usada", type: "expense", isDefault: false } as const;
    const standard = { id: "standard", ownerUid, name: "Padrão", type: "expense", isDefault: true } as const;
    await categoriesRepository.put(free);
    await categoriesRepository.put(used);
    await categoriesRepository.put(standard);
    const active = { ...transaction("category-active", "expense", ownerUid), categoryId: used.id, categoryName: used.name };
    const props = {
      ownerUid,
      items: [active],
      categories: [free, used, standard],
      onChanged: vi.fn(async () => {}),
      onError: vi.fn(),
      onMessage: vi.fn(),
    };
    const { unmount } = render(<CategoriesView {...props} />);
    const deleteButtons = screen.getAllByRole("button", { name: "Excluir" });
    expect(deleteButtons).toHaveLength(2);
    expect(deleteButtons[1]?.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Altere a categoria dos lançamentos ativos/)).toBeTruthy();
    expect(screen.getByText("Categoria padrão protegida.")).toBeTruthy();
    fireEvent.click(deleteButtons[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect((await categoriesRepository.list(ownerUid)).some((value) => value.id === free.id)).toBe(true);
    fireEvent.click(deleteButtons[0]!);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Excluir" }));
    await waitFor(async () => expect((await categoriesRepository.list(ownerUid)).some((value) => value.id === free.id)).toBe(false));
    unmount();
  });

  it("cria e seleciona categoria sem sair do formulário", async () => {
    const onChange = vi.fn();
    const onCategoriesChanged = vi.fn(async () => {});
    render(
      <CategoryPicker
        ownerUid="inline-category-user"
        type="expense"
        categories={[]}
        value=""
        onChange={onChange}
        onCategoriesChanged={onCategoriesChanged}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Categoria Selecione/ }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar categoria manualmente" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nome da nova categoria" }), {
      target: { value: "  Viagem  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar e selecionar" }));
    await waitFor(() => expect(onCategoriesChanged).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith(expect.any(String));
  });

  it("exibe duplicidade pela mesma regra usada no gerenciamento", async () => {
    await addCategory("duplicate-category-user", "Viagem", "expense");
    render(
      <CategoryPicker
        ownerUid="duplicate-category-user"
        type="expense"
        categories={[]}
        value=""
        onChange={vi.fn()}
        onCategoriesChanged={vi.fn(async () => {})}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Categoria Selecione/ }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar categoria manualmente" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nome da nova categoria" }), {
      target: { value: "  viagem " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar e selecionar" }));
    expect(await screen.findByText("Essa categoria já existe.")).toBeTruthy();
  });

  it("mantém categorias em ordem alfabética em todos os seletores e listas", () => {
    const ownerUid = "ordered-categories-user";
    const orderedCategories: Category[] = [
      { id: "z", ownerUid, name: "Zoológico", type: "expense", isDefault: false },
      { id: "a2", ownerUid, name: "alimentação", type: "expense", isDefault: false },
      { id: "a1", ownerUid, name: "Água", type: "expense", isDefault: false },
    ];
    const expected = ["Água", "alimentação", "Zoológico"];

    const picker = render(
      <CategoryPicker ownerUid={ownerUid} type="expense" categories={orderedCategories} value="z" onChange={vi.fn()} onCategoriesChanged={vi.fn(async () => {})} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Categoria Zoológico/ }));
    expect(screen.getAllByRole("option").map((option) => option.textContent?.replace("Selecionada", ""))).toEqual(expected);
    expect(screen.getByRole("option", { name: /Zoológico/ }).getAttribute("aria-selected")).toBe("true");
    picker.unmount();

    const management = render(
      <CategoriesView ownerUid={ownerUid} items={[]} categories={orderedCategories} onChanged={vi.fn(async () => {})} onError={vi.fn()} onMessage={vi.fn()} />,
    );
    expect(Array.from(document.querySelectorAll(".category-list")[0]!.children).map((item) => item.querySelector("span")?.firstChild?.textContent?.trim())).toEqual(expected);
    management.unmount();

    const filters = render(
      <TransactionFilters filters={{}} categories={orderedCategories} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: /Categoria Todas/ }));
    expect(screen.getAllByRole("option").slice(1).map((option) => option.textContent?.trim())).toEqual(expected);
    filters.unmount();

    const report = render(
      <ReportModal open ownerUid={ownerUid} transactions={[]} profiles={[]} categories={orderedCategories} onClose={vi.fn()} onError={vi.fn()} onMessage={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: /Categoria Todas as categorias/ }));
    expect(screen.getAllByRole("option").slice(1).map((option) => option.textContent?.replace(" · Despesa", "").trim())).toEqual(expected);
    expect(document.querySelector(".as-field__select")).toBeNull();
    report.unmount();
  });

  it("oferece Direito de uso e Política de privacidade como ações reais no login", () => {
    render(<LoginView busy={false} onLogin={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Direito de uso" })).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Política de privacidade" })
        .getAttribute("href"),
    ).toBe(
      "https://jeanluis-dev.github.io/Central-de-Privacidade/apps/gastos-simples.html",
    );
  });

  it("leva o resultado da calculadora ao formulário sem criar lançamento", async () => {
    const onUseValue = vi.fn();
    render(
      <CalculatorView
        ownerUid="calculator-user"
        onError={vi.fn()}
        onMessage={vi.fn()}
        onUseValue={onUseValue}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Expressão" }), {
      target: { value: "0,1 + 0,2 × 3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "=" }));
    await waitFor(() => expect(screen.getByText("0,7")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Usar no lançamento" }));
    expect(onUseValue).toHaveBeenCalledWith({
      amountCents: 70,
      notes: "Resultado de 0,1 + 0,2 × 3",
    });
  });

  it("usa resultado brasileiro vindo do histórico e invalida resultado antigo ao editar", async () => {
    const onUseValue = vi.fn();
    await calculatorRepository.put({
      id: "legacy-comma-result",
      ownerUid: "calculator-comma-user",
      expression: "1,25",
      result: "1,25",
      createdAt: "2028-01-01T00:00:00.000Z",
    });
    render(
      <CalculatorView
        ownerUid="calculator-comma-user"
        onError={vi.fn()}
        onMessage={vi.fn()}
        onUseValue={onUseValue}
      />,
    );
    const occurrences = await screen.findAllByText("1,25");
    fireEvent.click(occurrences[0]!.closest("button")!);
    const useButton = screen.getByRole("button", { name: "Usar no lançamento" });
    expect(useButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(useButton);
    expect(onUseValue).toHaveBeenCalledWith({
      amountCents: 125,
      notes: "Resultado de 1,25",
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Expressão" }), {
      target: { value: "2" },
    });
    expect(useButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText("Resultado: 0")).toBeTruthy();
  });

  it("informa a falha da Clipboard API depois do fallback seguro", async () => {
    const onError = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error("indisponível");
        }),
      },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    render(
      <CalculatorView
        ownerUid="clipboard-user"
        onError={onError}
        onMessage={vi.fn()}
        onUseValue={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Expressão" }), {
      target: { value: "2 + 2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "=" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Resultado: 4")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copiar resultado" }));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        "Não foi possível copiar. Selecione o resultado e copie manualmente.",
      ),
    );
  });

  it("oferece teclado virtual completo e permite corrigir a expressão", async () => {
    render(
      <CalculatorView
        ownerUid="keypad-user"
        onError={vi.fn()}
        onMessage={vi.fn()}
        onUseValue={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Apagar último caractere" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    fireEvent.click(screen.getByRole("button", { name: "=" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Resultado: 4")).toBeTruthy(),
    );
    for (const key of ["C", "±", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "0", ","])
      expect(screen.getByRole("button", { name: key })).toBeTruthy();
  });

  it("calcula subtração pelo teclado virtual", async () => {
    render(
      <CalculatorView
        ownerUid="subtraction-keypad-user"
        onError={vi.fn()}
        onMessage={vi.fn()}
        onUseValue={vi.fn()}
      />,
    );
    for (const key of ["1", "0", "0", "−", "1", "5", "="])
      fireEvent.click(screen.getByRole("button", { name: key }));
    await waitFor(() =>
      expect(screen.getByLabelText("Resultado: 85")).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "C" }));
    for (const key of ["1", "0", ",", "5", "−", "2", ",", "5", "="])
      fireEvent.click(screen.getByRole("button", { name: key }));
    expect(
      (screen.getByRole("textbox", { name: "Expressão" }) as HTMLInputElement)
        .value,
    ).toBe("10,5-2,5");
    await waitFor(() =>
      expect(screen.getByLabelText("Resultado: 8")).toBeTruthy(),
    );
  });

  it("continua o cálculo com o resultado anterior e registra o histórico correto", async () => {
    const ownerUid = "chained-calculation-user";
    render(
      <CalculatorView
        ownerUid={ownerUid}
        onError={vi.fn()}
        onMessage={vi.fn()}
        onUseValue={vi.fn()}
      />,
    );
    const expression = screen.getByRole("textbox", { name: "Expressão" });
    for (const key of ["1", "0", "0", "−", "1", "5", "="])
      fireEvent.click(screen.getByRole("button", { name: key }));
    await waitFor(() =>
      expect(screen.getByLabelText("Resultado: 85")).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "+" }));
    expect((expression as HTMLInputElement).value).toBe("85+");
    for (const key of ["1", "5", "="])
      fireEvent.click(screen.getByRole("button", { name: key }));
    await waitFor(() =>
      expect(screen.getByLabelText("Resultado: 100")).toBeTruthy(),
    );
    await waitFor(async () =>
      expect(
        (await calculatorRepository.list(ownerUid)).map(
          ({ expression: savedExpression, result: savedResult }) => [
            savedExpression,
            savedResult,
          ],
        ),
      ).toEqual(
        expect.arrayContaining([
          ["100-15", "85"],
          ["85+15", "100"],
        ]),
      ),
    );
  });

  it("inicia um novo cálculo com número ou vírgula depois do resultado", async () => {
    render(
      <CalculatorView
        ownerUid="restart-after-result-user"
        onError={vi.fn()}
        onMessage={vi.fn()}
        onUseValue={vi.fn()}
      />,
    );
    const expression = screen.getByRole("textbox", { name: "Expressão" });
    for (const key of ["2", "+", "2", "="])
      fireEvent.click(screen.getByRole("button", { name: key }));
    await waitFor(() =>
      expect(screen.getByLabelText("Resultado: 4")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "7" }));
    expect((expression as HTMLInputElement).value).toBe("7");
    expect(screen.getByLabelText("Resultado: 0")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "=" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Resultado: 7")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "," }));
    expect((expression as HTMLInputElement).value).toBe("0,");
    expect(screen.getByLabelText("Resultado: 0")).toBeTruthy();
  });

  it("permite cancelar a importação sem modificar dados", async () => {
    render(
      <SettingsView
        user={{
          uid: "settings-user",
          displayName: "Usuário",
          email: "user@example.test",
          photoURL: null,
        }}
        entitlement={{ status: "active", hasAccess: true }}
        onLogout={vi.fn()}
        onChanged={vi.fn(async () => {})}
        onError={vi.fn()}
        onMessage={vi.fn()}
      />,
    );
    const file = new File(["{}"], "backup.json", { type: "application/json" });
    Object.defineProperty(file, "text", {
      value: vi.fn(async () =>
        JSON.stringify({
          schemaVersion: 2,
          app: "Gastos Simples",
          ownerUid: "settings-user",
          exportedAt: "2028-01-01T00:00:00.000Z",
          transactions: [],
          categories: [],
          calculator: [],
          preferences: { theme: "system", confirmBeforeDelete: true },
        }),
      ),
    });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(
      await screen.findByRole("heading", { name: "Importar backup" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Importar backup" }),
      ).toBeNull(),
    );
  });

  it("mantém apenas preferências úteis no tema escuro", () => {
    render(
      <SettingsView
        user={{ uid: "dark-settings-user", displayName: "Usuário", email: "user@example.test", photoURL: null }}
        entitlement={{ status: "active", hasAccess: true }}
        onLogout={vi.fn()}
        onChanged={vi.fn(async () => {})}
        onError={vi.fn()}
        onMessage={vi.fn()}
      />,
    );
    expect(screen.queryByRole("heading", { name: "Aparência" })).toBeNull();
    expect(screen.queryByLabelText("Tema")).toBeNull();
    expect(screen.queryByLabelText("Confirmar antes de excluir lançamentos")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Preferências" })).toBeNull();
    expect(document.documentElement.style.colorScheme).not.toBe("light");
  });

  it("unifica conta e assinatura e destaca Sair sem duplicar o logout", () => {
    const onLogout = vi.fn();
    render(
      <SettingsView
        user={{ uid: "unified-account-user", displayName: "Jean Luis", email: "jean@example.test", photoURL: null }}
        entitlement={{ status: "active", hasAccess: true }}
        onLogout={onLogout}
        onChanged={vi.fn(async () => {})}
        onError={vi.fn()}
        onMessage={vi.fn()}
      />,
    );
    const accountHeading = screen.getByRole("heading", { name: "Conta Google" });
    const subscriptionHeading = screen.getByRole("heading", { name: "Assinatura" });
    expect(accountHeading.closest(".as-card")).toBe(subscriptionHeading.closest(".as-card"));
    expect(accountHeading.closest(".account-subscription-card")).toBeTruthy();
    expect(screen.getByText("Jean Luis")).toBeTruthy();
    expect(screen.getByText("jean@example.test")).toBeTruthy();
    expect(screen.getByText("Situação:").parentElement?.textContent).toContain("active");
    const logout = screen.getByRole("button", { name: "Sair" });
    expect(logout.classList.contains("as-button--secondary")).toBe(true);
    expect(logout.classList.contains("as-button--danger")).toBe(false);
    fireEvent.click(logout);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it.each(["active", "trial", "paused"] as const)(
    "mantém o cancelamento e seu modal para assinatura %s",
    (status) => {
      render(
        <SettingsView
          user={{ uid: `cancel-${status}`, displayName: "Usuário", email: "user@example.test", photoURL: null }}
          entitlement={{ status, hasAccess: status !== "paused" }}
          onLogout={vi.fn()}
          onChanged={vi.fn(async () => {})}
          onError={vi.fn()}
          onMessage={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Cancelar assinatura" }));
      const dialog = screen.getByRole("dialog", { name: "Cancelar assinatura" });
      expect(dialog).toBeTruthy();
      expect(within(dialog).getByRole("button", { name: "Solicitar cancelamento" })).toBeTruthy();
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
      expect(screen.queryByRole("dialog", { name: "Cancelar assinatura" })).toBeNull();
    },
  );

  it.each([
    "admin",
    "none",
    "pending",
    "in_process",
    "cancelled",
    "rejected",
    "expired",
    "temporary_error",
  ] as const)("não oferece cancelamento para acesso %s", (status) => {
    render(
      <SettingsView
        user={{ uid: `no-cancel-${status}`, displayName: "Usuário", email: "user@example.test", photoURL: null }}
        entitlement={{ status, hasAccess: status === "admin" }}
        onLogout={vi.fn()}
        onChanged={vi.fn(async () => {})}
        onError={vi.fn()}
        onMessage={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Cancelar assinatura" })).toBeNull();
  });

  it("identifica acesso administrativo e não oferece cancelamento", () => {
    render(
      <SettingsView
        user={{ uid: "admin-user", displayName: "Admin", email: "admin@example.test", photoURL: null }}
        entitlement={{ status: "admin", hasAccess: true }}
        onLogout={vi.fn()}
        onChanged={vi.fn(async () => {})}
        onError={vi.fn()}
        onMessage={vi.fn()}
      />,
    );
    expect(screen.getByText("Acesso administrativo")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancelar assinatura" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Conta Google" }).closest(".as-card")).toBe(
      screen.getByRole("heading", { name: "Assinatura" }).closest(".as-card"),
    );
  });

  it("remove controles redundantes do Resumo e abre Relatórios em Ajustes com restauração de foco", async () => {
    render(
      <DashboardApp
        user={{ uid: "report-settings-user", displayName: "Usuário", email: "user@example.test", photoURL: null }}
        entitlement={{ status: "active", hasAccess: true }}
        onLogout={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Gerenciar perfis" })).toBeNull();
    expect(screen.queryByText(/^Exibindo:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Exportar relatório" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Abrir Ajustes" }));
    expect(await screen.findByRole("heading", { name: "Ajustes" })).toBeTruthy();
    expect(screen.queryByText("PREFERÊNCIAS E CONTA")).toBeNull();
    expect(screen.getByText("Gere um relatório financeiro por perfil, período e categoria.")).toBeTruthy();
    const trigger = screen.getByRole("button", { name: "Exportar relatório" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("heading", { name: "Exportar relatório" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Exportar relatório" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("expõe ações compactas e acessíveis nos perfis", () => {
    const profile = {
      id: "long-profile",
      ownerUid: "profile-icons-user",
      name: "Perfil financeiro com um nome muito longo para testar o alinhamento",
      createdAt: "2028-01-01T00:00:00Z",
      updatedAt: "2028-01-01T00:00:00Z",
    };
    render(
      <FinancialProfilesCard
        ownerUid={profile.ownerUid}
        profiles={[profile]}
        transactions={[]}
        selectedProfileId=""
        onChanged={vi.fn(async () => {})}
        onSelectionChanged={vi.fn(async () => {})}
        onError={vi.fn()}
        onMessage={vi.fn()}
      />,
    );
    expect(screen.queryByText("Organização local dentro desta conta Google.")).toBeNull();
    const rename = screen.getByRole("button", { name: `Renomear perfil ${profile.name}` });
    const remove = screen.getByRole("button", { name: `Excluir perfil ${profile.name}` });
    expect(rename.getAttribute("title")).toBe(`Renomear perfil ${profile.name}`);
    expect(remove.getAttribute("title")).toBe(`Excluir perfil ${profile.name}`);
    expect(remove.hasAttribute("disabled")).toBe(true);
  });

  it("renomeia perfil e devolve o foco ao ícone acionador", async () => {
    const ownerUid = "profile-rename-user";
    const [profile] = await ensureFinancialProfiles(ownerUid);
    render(
      <FinancialProfilesCard ownerUid={ownerUid} profiles={[profile!]} transactions={[]} selectedProfileId="" onChanged={vi.fn(async () => {})} onSelectionChanged={vi.fn(async () => {})} onError={vi.fn()} onMessage={vi.fn()} />,
    );
    const trigger = screen.getByRole("button", { name: "Renomear perfil Principal" });
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole("textbox", { name: "Nome do perfil" }), { target: { value: "Casa" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(async () => expect((await profilesRepository.list(ownerUid))[0]?.name).toBe("Casa"));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("transfere lançamentos ao excluir um perfil pelo ícone", async () => {
    const ownerUid = "profile-delete-user";
    const [principal] = await ensureFinancialProfiles(ownerUid);
    const secondary = await addFinancialProfile(ownerUid, "Casa");
    const linked = { ...transaction("profile-transfer", "expense", ownerUid), profileId: secondary.id };
    await transactionsRepository.put(linked);
    render(
      <FinancialProfilesCard ownerUid={ownerUid} profiles={[principal!, secondary]} transactions={[linked]} selectedProfileId={secondary.id} onChanged={vi.fn(async () => {})} onSelectionChanged={vi.fn(async () => {})} onError={vi.fn()} onMessage={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Excluir perfil Casa" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Excluir perfil" }));
    await waitFor(async () => expect((await profilesRepository.list(ownerUid)).map(({ name }) => name)).toEqual(["Principal"]));
    expect((await transactionsRepository.list(ownerUid))[0]?.profileId).toBe(principal!.id);
  });

  it.each(["Cancelar", "Escape"])("cancela Começar do zero por %s sem alterar dados e restaura o foco", async (action) => {
    const ownerUid = `reset-cancel-${action}`;
    const [principal] = await ensureFinancialProfiles(ownerUid);
    await transactionsRepository.put({ ...transaction(`keep-${action}`, "expense", ownerUid), profileId: principal!.id });
    render(
      <SettingsView user={{ uid: ownerUid, displayName: "Usuário", email: "user@example.test", photoURL: null }} entitlement={{ status: "active", hasAccess: true }} onLogout={vi.fn()} onChanged={vi.fn(async () => {})} onError={vi.fn()} onMessage={vi.fn()} profiles={[principal!]} />,
    );
    const trigger = screen.getByRole("button", { name: "Começar do zero" });
    fireEvent.click(trigger);
    if (action === "Cancelar") fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    else fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Começar do zero" })).toBeNull());
    expect(await transactionsRepository.list(ownerUid)).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("reinicia os dados uma única vez sem afetar conta ou assinatura", async () => {
    const ownerUid = "reset-settings-user";
    const [principal] = await ensureFinancialProfiles(ownerUid);
    await addFinancialProfile(ownerUid, "Casa");
    await transactionsRepository.put({ ...transaction("reset-active", "expense", ownerUid), profileId: principal!.id });
    await transactionsRepository.put({ ...transaction("reset-deleted", "expense", ownerUid), profileId: principal!.id, isDeleted: true });
    await categoriesRepository.put({ id: "reset-custom", ownerUid, name: "Personalizada", type: "expense", isDefault: false });
    await calculatorRepository.put({ id: "reset-calculation", ownerUid, expression: "1 + 1", result: "2", createdAt: "2028-01-01T00:00:00Z" });
    const onChanged = vi.fn(async () => {});
    const onMessage = vi.fn();
    const onProfileSelectionChanged = vi.fn(async () => {});
    const onLogout = vi.fn();
    render(
      <SettingsView user={{ uid: ownerUid, displayName: "Conta preservada", email: "preservada@example.test", photoURL: null }} entitlement={{ status: "active", hasAccess: true }} onLogout={onLogout} onChanged={onChanged} onError={vi.fn()} onMessage={onMessage} profiles={await profilesRepository.list(ownerUid)} transactions={await transactionsRepository.list(ownerUid)} selectedProfileId={principal!.id} onProfileSelectionChanged={onProfileSelectionChanged} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Começar do zero" }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "Sim, começar do zero" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(await transactionsRepository.list(ownerUid)).toEqual([]);
    expect(await calculatorRepository.list(ownerUid)).toEqual([]);
    expect((await categoriesRepository.list(ownerUid))).toHaveLength(18);
    expect((await profilesRepository.list(ownerUid)).map(({ name }) => name)).toEqual(["Principal"]);
    expect(onProfileSelectionChanged).toHaveBeenCalledWith("");
    expect(onMessage).toHaveBeenCalledWith("Aplicativo reiniciado. Seus dados locais foram removidos.");
    expect(screen.getByText("Conta preservada")).toBeTruthy();
    expect(screen.getByText("Situação:").parentElement?.textContent).toContain("active");
    expect(onLogout).not.toHaveBeenCalled();
  });
});
