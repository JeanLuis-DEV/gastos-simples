import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyncManager, SyncSnapshot } from "../../sync/engine";
import { SYNC_PRIVACY_POLICY_VERSION } from "../../../shared/syncPolicy";

const syncSnapshot = (changes: Partial<SyncSnapshot> = {}): SyncSnapshot => ({
  status: "disabled",
  enabled: false,
  available: true,
  canPush: true,
  canExport: true,
  canDelete: true,
  hasRemoteData: false,
  conflictCount: 0,
  ...changes,
});

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
    render(<SyncSettingsCard ownerUid="uid" manager={manager} snapshot={syncSnapshot()} onChanged={vi.fn(async () => undefined)} onError={vi.fn()} onMessage={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Ativar sincronização" }));
    const checkbox = screen.getByRole("checkbox", { name: /Li as informações/i }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    const buttons = screen.getAllByRole("button", { name: "Ativar sincronização" });
    expect(buttons.at(-1)?.hasAttribute("disabled")).toBe(true);
    fireEvent.click(checkbox);
    fireEvent.click(buttons.at(-1)!);
    await waitFor(() => expect(activate).toHaveBeenCalledWith(SYNC_PRIVACY_POLICY_VERSION));
  });

  it("não expõe a interface de sincronização quando o backend não autoriza a conta", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "true");
    vi.resetModules();
    const manager = { activate: vi.fn(), syncNow: vi.fn(), disable: vi.fn(), refreshStatus: vi.fn(), schedule: vi.fn() } as unknown as SyncManager;
    const { SyncSettingsCard } = await import("./SyncSettingsCard");
    render(<SyncSettingsCard ownerUid="uid" manager={manager} snapshot={syncSnapshot({ available: false })} onChanged={vi.fn(async () => undefined)} onError={vi.fn()} onMessage={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: "Seus dados e sincronização" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ativar sincronização" })).toBeNull();
  });

  it("separa o estado sincronizado da ação manual e permite ativação por teclado", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "true");
    vi.resetModules();
    const { SyncStatus } = await import("./SyncStatus");
    const onSync = vi.fn(async () => undefined);
    render(<SyncStatus snapshot={syncSnapshot({ status: "synced", enabled: true })} onSync={onSync} />);
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
    render(<SyncStatus snapshot={syncSnapshot({ status: "synced", enabled: true })} onSync={onSync} />);
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
    render(<SyncStatus snapshot={syncSnapshot({ status, enabled: true, conflictCount: status === "conflicts" ? 1 : 0 })} onSync={onSync} />);
    expect(screen.getByRole("status").textContent).toBe(stateLabel);
    if (actionLabel) {
      fireEvent.click(screen.getByRole("button", { name: actionLabel }));
      await waitFor(() => expect(onSync).toHaveBeenCalledTimes(1));
    } else {
      expect(screen.queryByRole("button")).toBeNull();
      expect(onSync).not.toHaveBeenCalled();
    }
  });

  it("remove a exportação local da sincronização e preserva o Backup local", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "true");
    vi.resetModules();
    const manager = { activate: vi.fn(), syncNow: vi.fn(), disable: vi.fn(), refreshStatus: vi.fn(), schedule: vi.fn() } as unknown as SyncManager;
    const { SyncSettingsCard } = await import("./SyncSettingsCard");
    const { unmount } = render(<SyncSettingsCard ownerUid="uid" manager={manager} snapshot={syncSnapshot({ hasRemoteData: true })} onChanged={vi.fn(async () => undefined)} onError={vi.fn()} onMessage={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Exportar dados locais" })).toBeNull();
    unmount();
    const { SettingsView } = await import("./SettingsView");
    render(<SettingsView user={{ uid: "uid", displayName: "Usuário", email: "user@example.test", photoURL: null }} entitlement={{ status: "admin", hasAccess: true }} onLogout={vi.fn()} onChanged={vi.fn(async () => undefined)} onError={vi.fn()} onMessage={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Exportar JSON" })).toBeTruthy();
  });

  it("exibe ações de nuvem apenas quando o backend confirma dados remotos, inclusive sem push ativo", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "true");
    vi.resetModules();
    const manager = { activate: vi.fn(), syncNow: vi.fn(), disable: vi.fn(), refreshStatus: vi.fn(), schedule: vi.fn() } as unknown as SyncManager;
    const { SyncSettingsCard } = await import("./SyncSettingsCard");
    const props = { ownerUid: "uid", manager, onChanged: vi.fn(async () => undefined), onError: vi.fn(), onMessage: vi.fn() };
    const view = render(<SyncSettingsCard {...props} snapshot={syncSnapshot({ canPush: false, hasRemoteData: false })} />);
    expect(screen.getByText("Nenhuma cópia financeira está armazenada na nuvem.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Baixar cópia da nuvem" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Excluir dados remotos" })).toBeNull();
    view.rerender(<SyncSettingsCard {...props} snapshot={syncSnapshot({ canPush: false, hasRemoteData: true })} />);
    expect(screen.getByRole("button", { name: "Baixar cópia da nuvem" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Excluir dados remotos" })).toBeTruthy();
  });

  it("baixa a cópia remota e mantém a exclusão forte com seus avisos", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "true");
    vi.resetModules();
    const client = await import("../../sync/client");
    const remote = vi.spyOn(client.syncApi, "exportRemote").mockResolvedValue({ schemaVersion: 4 } as never);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const manager = { activate: vi.fn(), syncNow: vi.fn(), disable: vi.fn(), refreshStatus: vi.fn(), schedule: vi.fn() } as unknown as SyncManager;
    const onMessage = vi.fn();
    const { SyncSettingsCard } = await import("./SyncSettingsCard");
    render(<SyncSettingsCard ownerUid="uid" manager={manager} snapshot={syncSnapshot({ canPush: false, hasRemoteData: true })} onChanged={vi.fn(async () => undefined)} onError={vi.fn()} onMessage={onMessage} />);
    fireEvent.click(screen.getByRole("button", { name: "Baixar cópia da nuvem" }));
    await waitFor(() => expect(remote).toHaveBeenCalledWith("uid"));
    expect(onMessage).toHaveBeenCalledWith("Cópia da nuvem baixada.");
    fireEvent.click(screen.getByRole("button", { name: "Excluir dados remotos" }));
    const dialog = screen.getByRole("dialog", { name: "Excluir dados remotos" });
    expect(within(dialog).getByText(/Conta Google, a assinatura nem registros legais de pagamento/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Excluir dados remotos" }).hasAttribute("disabled")).toBe(true);
  });

  it("usa a autenticação recente antes de abrir uma nova janela Google", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "true");
    vi.resetModules();
    const client = await import("../../sync/client");
    const auth = await import("../../services/auth");
    const intent = vi.spyOn(client.syncApi, "deletionIntent").mockResolvedValue({ nonce: "nonce", expiresAt: "2028-01-01" });
    const remove = vi.spyOn(client.syncApi, "deleteRemote").mockResolvedValue({ deleted: true, syncEpoch: 2 });
    const reauthenticate = vi.spyOn(auth, "reauthenticateWithGoogle").mockResolvedValue(undefined);
    const manager = { activate: vi.fn(), syncNow: vi.fn(), disable: vi.fn(), refreshStatus: vi.fn(), schedule: vi.fn() } as unknown as SyncManager;
    const { SyncSettingsCard } = await import("./SyncSettingsCard");
    render(<SyncSettingsCard ownerUid="uid" manager={manager} snapshot={syncSnapshot({ hasRemoteData: true })} onChanged={vi.fn(async () => undefined)} onError={vi.fn()} onMessage={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Excluir dados remotos" }));
    const dialog = screen.getByRole("dialog", { name: "Excluir dados remotos" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "EXCLUIR" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Excluir dados remotos" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("nonce"));
    expect(intent).toHaveBeenCalledOnce();
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  it("reautentica somente quando o servidor exige sessão recente", async () => {
    vi.stubEnv("VITE_SYNC_ENABLED", "true");
    vi.resetModules();
    const client = await import("../../sync/client");
    const auth = await import("../../services/auth");
    const intent = vi.spyOn(client.syncApi, "deletionIntent")
      .mockRejectedValueOnce(new client.SyncHttpError(401, "Confirme novamente sua identidade."))
      .mockResolvedValueOnce({ nonce: "nonce", expiresAt: "2028-01-01" });
    const remove = vi.spyOn(client.syncApi, "deleteRemote").mockResolvedValue({ deleted: true, syncEpoch: 2 });
    const reauthenticate = vi.spyOn(auth, "reauthenticateWithGoogle").mockResolvedValue(undefined);
    const manager = { activate: vi.fn(), syncNow: vi.fn(), disable: vi.fn(), refreshStatus: vi.fn(), schedule: vi.fn() } as unknown as SyncManager;
    const { SyncSettingsCard } = await import("./SyncSettingsCard");
    render(<SyncSettingsCard ownerUid="uid" manager={manager} snapshot={syncSnapshot({ hasRemoteData: true })} onChanged={vi.fn(async () => undefined)} onError={vi.fn()} onMessage={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Excluir dados remotos" }));
    const dialog = screen.getByRole("dialog", { name: "Excluir dados remotos" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "EXCLUIR" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Excluir dados remotos" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("nonce"));
    expect(intent).toHaveBeenCalledTimes(2);
    expect(reauthenticate).toHaveBeenCalledOnce();
  });
});
