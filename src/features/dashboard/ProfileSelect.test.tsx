import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FinancialProfile } from "../../domain/models";
import { ProfileSelect } from "./ProfileSelect";
import { AccessibleSelect } from "./AccessibleSelect";

const profiles = (count = 3): FinancialProfile[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `profile-${index + 1}`,
    ownerUid: "profile-select-user",
    name:
      index === 1
        ? "Perfil familiar compartilhado com nome completo e extenso"
        : `Perfil ${index + 1}`,
    createdAt: "2028-01-01T00:00:00.000Z",
    updatedAt: "2028-01-01T00:00:00.000Z",
  }));

describe("ProfileSelect", () => {
  it("reutiliza o seletor genérico para opções arbitrárias", () => {
    const onChange = vi.fn();
    render(
      <AccessibleSelect
        label="Tipo"
        value="expense"
        onChange={onChange}
        options={[
          { value: "expense", label: "Despesa" },
          { value: "income", label: "Receita com descrição longa para validar contenção" },
        ]}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Tipo Despesa" });
    fireEvent.keyDown(trigger, { key: "End" });
    fireEvent.keyDown(
      screen.getByRole("option", { name: /Receita com descrição longa/ }),
      { key: " " },
    );
    expect(onChange).toHaveBeenCalledWith("income");
    expect(document.querySelector("select")).toBeNull();
  });
  it("expõe combobox/listbox, destaca a seleção e evita seleção duplicada", async () => {
    const onChange = vi.fn();
    render(<ProfileSelect label="Perfil financeiro" profiles={profiles()} includeAll value="profile-1" onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Perfil financeiro Perfil 1" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    const listbox = screen.getByRole("listbox", { name: "Perfil financeiro" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(listbox.id);
    expect(within(listbox).getByRole("option", { name: "Perfil 1" }).getAttribute("aria-selected")).toBe("true");
    expect(within(listbox).getByRole("option", { name: "Todos os perfis" })).toBeTruthy();
    const option = within(listbox).getByRole("option", { name: /Perfil familiar compartilhado/ });
    fireEvent.click(option);
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("profile-2");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("seleciona Todos os perfis e mantém o nome completo acessível", () => {
    const onChange = vi.fn();
    render(<ProfileSelect label="Perfil financeiro" profiles={profiles()} includeAll value="profile-2" onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: /Perfil financeiro Perfil familiar/ });
    expect(trigger.getAttribute("title")).toBe("Perfil familiar compartilhado com nome completo e extenso");
    fireEvent.click(trigger);
    const longOption = screen.getByRole("option", { name: /Perfil familiar compartilhado/ });
    expect(longOption.getAttribute("title")).toBe("Perfil familiar compartilhado com nome completo e extenso");
    fireEvent.click(screen.getByRole("option", { name: "Todos os perfis" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("navega por setas, Home, End, Enter e Espaço", async () => {
    const onChange = vi.fn();
    render(<ProfileSelect profiles={profiles()} value="profile-1" onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Perfil Perfil 1" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const first = screen.getByRole("option", { name: "Perfil 1" });
    const second = screen.getByRole("option", { name: /Perfil familiar/ });
    const last = screen.getByRole("option", { name: "Perfil 3" });
    await waitFor(() => expect(document.activeElement).toBe(first));
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "End" });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Home" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("profile-3");
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.keyDown(trigger, { key: " " });
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
  });

  it("fecha por Escape, Tab e clique externo sem alterar a seleção", async () => {
    const onChange = vi.fn();
    const onParentKeyDown = vi.fn();
    render(<div onKeyDown={onParentKeyDown}><ProfileSelect profiles={profiles()} value="profile-1" onChange={onChange} /><button>Depois</button></div>);
    const trigger = screen.getByRole("combobox", { name: "Perfil Perfil 1" });
    fireEvent.click(trigger);
    const first = screen.getByRole("option", { name: "Perfil 1" });
    fireEvent.keyDown(first, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onParentKeyDown).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("option", { name: "Perfil 1" }), { key: "Tab" });
    expect(screen.queryByRole("listbox")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Depois" })));
    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole("button", { name: "Depois" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ["down", 100, 148],
    ["up", 700, 748],
  ] as const)("abre para %s conforme o espaço disponível", (direction, top, bottom) => {
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    const { unmount } = render(<main className="app-container"><ProfileSelect profiles={profiles(20)} value="profile-1" onChange={vi.fn()} /></main>);
    const container = document.querySelector(".app-container") as HTMLElement;
    const trigger = screen.getByRole("combobox");
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 12, y: 0, width: 351, height: 788 }));
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 20, y: top, width: 335, height: bottom - top }));
    fireEvent.click(trigger);
    const listbox = screen.getByRole("listbox");
    expect(listbox.getAttribute("data-direction")).toBe(direction);
    expect(Number.parseFloat(listbox.style.maxHeight)).toBeLessThanOrEqual(320);
    expect(within(listbox).getAllByRole("option")).toHaveLength(20);
    unmount();
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
  });
});
