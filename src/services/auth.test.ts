import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApps: vi.fn(() => [{}]),
  getAuth: vi.fn(() => ({ currentUser: null })),
  getRedirectResult: vi.fn(),
  onAuthStateChanged: vi.fn(),
  setPersistence: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("firebase/app", () => ({
  getApps: mocks.getApps,
  initializeApp: vi.fn(),
}));
vi.mock("firebase/auth", () => ({
  indexedDBLocalPersistence: { type: "indexed-db" },
  browserLocalPersistence: { type: "local" },
  browserSessionPersistence: { type: "session" },
  getAuth: mocks.getAuth,
  getRedirectResult: mocks.getRedirectResult,
  GoogleAuthProvider: class {
    setCustomParameters = vi.fn();
  },
  onAuthStateChanged: mocks.onAuthStateChanged,
  setPersistence: mocks.setPersistence,
  signInWithPopup: mocks.signInWithPopup,
  signInWithRedirect: mocks.signInWithRedirect,
  signOut: mocks.signOut,
}));
vi.mock("../config", () => ({
  getPublicConfig: () => ({ firebase: {} }),
}));

async function service() {
  return import("./auth");
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.setPersistence.mockResolvedValue(undefined);
  mocks.getRedirectResult.mockResolvedValue(null);
  mocks.signInWithPopup.mockResolvedValue({});
  mocks.signInWithRedirect.mockResolvedValue(undefined);
  mocks.onAuthStateChanged.mockReturnValue(vi.fn());
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("autenticação Firebase", () => {
  it("processa o retorno do redirect antes de configurar persistência", async () => {
    const { initializeAuth } = await service();
    initializeAuth(vi.fn());
    await settle();

    expect(mocks.setPersistence).toHaveBeenCalledOnce();
    expect(mocks.getRedirectResult).toHaveBeenCalledOnce();
    expect(mocks.getRedirectResult.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.setPersistence.mock.invocationCallOrder[0]!,
    );
  });

  it("não bloqueia getRedirectResult enquanto a persistência está pendente", async () => {
    mocks.setPersistence.mockImplementation(() => new Promise(() => {}));
    const { initializeAuth } = await service();

    initializeAuth(vi.fn());
    await settle();

    expect(mocks.getRedirectResult).toHaveBeenCalledOnce();
    expect(mocks.setPersistence).toHaveBeenCalledOnce();
  });

  it("compartilha a configuração de persistência entre bootstrap e login", async () => {
    let resolvePersistence: (() => void) | undefined;
    mocks.setPersistence.mockImplementation(
      () => new Promise<void>((resolve) => (resolvePersistence = resolve)),
    );
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const { initializeAuth, loginWithGoogle } = await service();

    initializeAuth(vi.fn());
    await settle();
    const login = loginWithGoogle();
    await settle();

    expect(mocks.setPersistence).toHaveBeenCalledOnce();
    expect(mocks.signInWithRedirect).not.toHaveBeenCalled();
    resolvePersistence?.();
    await login;
    expect(mocks.signInWithRedirect).toHaveBeenCalledOnce();
  });

  it("mantém o listener ativo quando getRedirectResult falha", async () => {
    const failure = { code: "auth/network-request-failed" };
    mocks.getRedirectResult.mockRejectedValue(failure);
    let stateListener: ((user: unknown) => void) | undefined;
    mocks.onAuthStateChanged.mockImplementation((_auth, onChange) => {
      stateListener = onChange;
      return vi.fn();
    });
    const onChange = vi.fn();
    const onError = vi.fn();
    const { initializeAuth } = await service();

    initializeAuth(onChange, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    stateListener?.({ uid: "restored" });

    expect(onChange).toHaveBeenCalledWith({ uid: "restored" });
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/conectar/));
  });

  it("usa IndexedDB, local e session em ordem como fallback", async () => {
    mocks.setPersistence
      .mockRejectedValueOnce(new Error("indexeddb"))
      .mockRejectedValueOnce(new Error("local"))
      .mockResolvedValueOnce(undefined);
    const { initializeAuth } = await service();
    initializeAuth(vi.fn());
    await settle();

    expect(
      mocks.setPersistence.mock.calls.map(([, persistence]) => persistence.type),
    ).toEqual(["indexed-db", "local", "session"]);
    expect(mocks.getRedirectResult).toHaveBeenCalledOnce();
  });

  it("usa redirect em dispositivo mobile", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const { loginWithGoogle } = await service();
    await loginWithGoogle();

    expect(mocks.setPersistence).toHaveBeenCalledOnce();
    expect(mocks.signInWithRedirect).toHaveBeenCalledOnce();
    expect(mocks.signInWithPopup).not.toHaveBeenCalled();
  });

  it("preserva popup no desktop", async () => {
    const { loginWithGoogle } = await service();
    await loginWithGoogle();

    expect(mocks.signInWithPopup).toHaveBeenCalledOnce();
    expect(mocks.signInWithRedirect).not.toHaveBeenCalled();
  });

  it("deduplica tentativas de login simultâneas", async () => {
    let resolvePopup: (() => void) | undefined;
    mocks.signInWithPopup.mockImplementation(
      () => new Promise<void>((resolve) => (resolvePopup = resolve)),
    );
    const { loginWithGoogle } = await service();

    const first = loginWithGoogle();
    const second = loginWithGoogle();
    await settle();
    expect(mocks.signInWithPopup).toHaveBeenCalledOnce();
    resolvePopup?.();
    await Promise.all([first, second]);
  });

  it("não mantém a inicialização carregando indefinidamente", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const { initializeAuth } = await service();
    const unsubscribe = initializeAuth(vi.fn(), onError);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/demorou/));
    unsubscribe();
  });
});
