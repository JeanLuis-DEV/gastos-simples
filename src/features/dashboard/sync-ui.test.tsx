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

  it("expõe estado por texto e bloqueia sincronização repetida", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "true");
    vi.resetModules();
    const { SyncStatus } = await import("./SyncStatus");
    render(<SyncStatus snapshot={{ status: "syncing", enabled: true, available: true, canPush: true, conflictCount: 0 }} onSync={vi.fn()} />);
    const button = screen.getByRole("button", { name: /Sincronizando/ });
    expect(button.textContent).toContain("Sincronizando");
    expect(button.hasAttribute("disabled")).toBe(true);
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
