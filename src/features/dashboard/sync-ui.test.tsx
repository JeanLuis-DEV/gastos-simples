import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyncManager } from "../../sync/engine";
import { SYNC_PRIVACY_POLICY_VERSION } from "../../../shared/syncPolicy";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("interface de sincronização", () => {
  it("exige consentimento expresso antes da primeira ativação", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "true");
    vi.resetModules();
    const activate = vi.fn(async () => undefined);
    const manager = { activate, syncNow: vi.fn(), disable: vi.fn(), refreshStatus: vi.fn(), schedule: vi.fn() } as unknown as SyncManager;
    const { SyncSettingsCard } = await import("./SyncSettingsCard");
    render(<SyncSettingsCard ownerUid="uid" manager={manager} snapshot={{ status: "disabled", enabled: false, available: true, canPush: true, conflictCount: 0 }} onChanged={vi.fn(async () => undefined)} onError={vi.fn()} onMessage={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Ativar sincronização" }));
    const checkbox = screen.getByRole("checkbox", { name: /Li as informações/i }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    const buttons = screen.getAllByRole("button", { name: "Ativar sincronização" });
    expect(buttons.at(-1)?.hasAttribute("disabled")).toBe(true);
    fireEvent.click(checkbox);
    fireEvent.click(buttons.at(-1)!);
    await waitFor(() => expect(activate).toHaveBeenCalledWith(SYNC_PRIVACY_POLICY_VERSION));
  });

  it("separa o estado sincronizado da ação manual e permite ativação por teclado", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "true");
    vi.resetModules();
    const { SyncStatus } = await import("./SyncStatus");
    const onSync = vi.fn(async () => undefined);
    render(<SyncStatus snapshot={{ status: "synced", enabled: true, available: true, canPush: true, conflictCount: 0 }} onSync={onSync} />);
    expect(screen.queryByRole("button", { name: "Sincronizado" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Sincronizado");
    const button = screen.getByRole("button", { name: "Sincronizar agora" });
    expect(button.tagName).toBe("BUTTON");
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button, { detail: 0 });
    await waitFor(() => expect(onSync).toHaveBeenCalledTimes(1));
  });

  it("mostra progresso e bloqueia cliques repetidos durante a sincronização", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "true");
    vi.resetModules();
    const { SyncStatus } = await import("./SyncStatus");
    let resolveSync!: () => void;
    const onSync = vi.fn(() => new Promise<void>((resolve) => { resolveSync = resolve; }));
    render(<SyncStatus snapshot={{ status: "synced", enabled: true, available: true, canPush: true, conflictCount: 0 }} onSync={onSync} />);
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar agora" }));
    const progress = await screen.findByRole("button", { name: "Sincronizando…" });
    expect(progress.hasAttribute("disabled")).toBe(true);
    fireEvent.click(progress);
    expect(onSync).toHaveBeenCalledTimes(1);
    resolveSync();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sincronizar agora" }).hasAttribute("disabled")).toBe(false));
  });

  it.each([
    ["offline", "Offline", null],
    ["error", "Erro ao sincronizar", "Tentar novamente"],
    ["conflicts", "Conflitos pendentes", "Sincronizar agora"],
  ] as const)("mantém estado e ação coerentes em %s", async (status, stateLabel, actionLabel) => {
    vi.stubEnv("VITE_SYNC_ENABLED", "true");
    vi.resetModules();
    const { SyncStatus } = await import("./SyncStatus");
    const onSync = vi.fn(async () => undefined);
    render(<SyncStatus snapshot={{ status, enabled: true, available: true, canPush: true, conflictCount: status === "conflicts" ? 1 : 0 }} onSync={onSync} />);
    expect(screen.getByRole("status").textContent).toBe(stateLabel);
    if (actionLabel) {
      fireEvent.click(screen.getByRole("button", { name: actionLabel }));
      await waitFor(() => expect(onSync).toHaveBeenCalledTimes(1));
    } else {
      expect(screen.queryByRole("button")).toBeNull();
      expect(onSync).not.toHaveBeenCalled();
    }
  });

  it("mantém a solicitação de exclusão remota disponível com a sincronização desativada", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "true");
    vi.resetModules();
    const manager = { activate: vi.fn(), syncNow: vi.fn(), disable: vi.fn(), refreshStatus: vi.fn(), schedule: vi.fn() } as unknown as SyncManager;
    const { SyncSettingsCard } = await import("./SyncSettingsCard");
    render(<SyncSettingsCard ownerUid="uid" manager={manager} snapshot={{ status: "disabled", enabled: false, available: true, canPush: false, conflictCount: 0 }} onChanged={vi.fn(async () => undefined)} onError={vi.fn()} onMessage={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Excluir dados remotos" })).toBeTruthy();
  });
});
