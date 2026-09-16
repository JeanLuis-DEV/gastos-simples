import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acknowledgePush: vi.fn(),
  applyRemotePage: vi.fn(),
  calculatorEntriesForSync: vi.fn(),
  discardOutboxEntries: vi.fn(),
  getSyncState: vi.fn(),
  listOutbox: vi.fn(),
  listSyncConflicts: vi.fn(),
  prepareFullResync: vi.fn(),
  replaceSyncState: vi.fn(),
  updateSyncState: vi.fn(),
  status: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
}));

vi.mock("../storage/database", () => ({
  acknowledgePush: mocks.acknowledgePush,
  applyRemotePage: mocks.applyRemotePage,
  calculatorEntriesForSync: mocks.calculatorEntriesForSync,
  discardOutboxEntries: mocks.discardOutboxEntries,
  getSyncState: mocks.getSyncState,
  listOutbox: mocks.listOutbox,
  listSyncConflicts: mocks.listSyncConflicts,
  prepareFullResync: mocks.prepareFullResync,
  replaceSyncState: mocks.replaceSyncState,
  updateSyncState: mocks.updateSyncState,
}));
vi.mock("./config", () => ({ canUseRemoteSync: () => true }));
vi.mock("./client", async (importOriginal) => {
  const original = await importOriginal<typeof import("./client")>();
  return {
    ...original,
    syncApi: {
      status: mocks.status,
      pull: mocks.pull,
      push: mocks.push,
      activate: vi.fn(),
      disable: vi.fn(),
      importRemote: vi.fn(),
    },
  };
});

import {
  SYNC_MUTATION_DEBOUNCE_MS,
  SYNC_SAVE_DATA_VISIBILITY_MIN_INTERVAL_MS,
  SYNC_VISIBILITY_MIN_INTERVAL_MS,
  SyncManager,
} from "./engine";

const ownerUid = "scheduler-owner";
const localState = {
  ownerUid,
  deviceId: "device-1",
  enabled: true,
  epoch: 1,
  cursor: 0,
};
const remoteStatus = {
  protocolVersion: 1 as const,
  available: true,
  enabled: true,
  syncEpoch: 1,
  highWatermark: 0,
  minAvailableRevision: 0,
  canPush: false,
  canPull: true,
  canExport: true,
  canDelete: true,
  serverTime: "2026-09-16T12:00:00.000Z",
};

class TestBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage() {}
  close() {}
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function startAndReset(manager: SyncManager) {
  manager.start();
  await settle();
  await vi.runOnlyPendingTimersAsync();
  await settle();
  vi.clearAllMocks();
  mocks.getSyncState.mockResolvedValue(localState);
  mocks.listOutbox.mockResolvedValue([]);
  mocks.listSyncConflicts.mockResolvedValue([]);
  mocks.status.mockResolvedValue(remoteStatus);
  mocks.pull.mockResolvedValue({
    protocolVersion: 1,
    syncEpoch: 1,
    highWatermark: 0,
    cursor: 0,
    hasMore: false,
    minAvailableRevision: 0,
    serverTime: remoteStatus.serverTime,
    records: [],
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-16T12:00:00.000Z"));
  vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    value: { saveData: false },
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  mocks.getSyncState.mockResolvedValue(localState);
  mocks.replaceSyncState.mockImplementation(async (_ownerUid, changes) => ({
    ...localState,
    ...changes,
  }));
  mocks.updateSyncState.mockResolvedValue(undefined);
  mocks.applyRemotePage.mockResolvedValue(undefined);
  mocks.listOutbox.mockResolvedValue([]);
  mocks.listSyncConflicts.mockResolvedValue([]);
  mocks.calculatorEntriesForSync.mockResolvedValue([]);
  mocks.status.mockResolvedValue(remoteStatus);
  mocks.pull.mockResolvedValue({
    protocolVersion: 1,
    syncEpoch: 1,
    highWatermark: 0,
    cursor: 0,
    hasMore: false,
    minAvailableRevision: 0,
    serverTime: remoteStatus.serverTime,
    records: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("agendamento orientado a eventos", () => {
  it("não agenda outra rodada após concluir nem ao publicar lastSyncedAt", async () => {
    const manager = new SyncManager(ownerUid);
    await startAndReset(manager);

    await manager.syncNow();
    const statusCalls = mocks.status.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2 * SYNC_VISIBILITY_MIN_INTERVAL_MS);

    expect(statusCalls).toBe(2);
    expect(mocks.status).toHaveBeenCalledTimes(statusCalls);
    manager.stop();
  });

  it("agrupa várias mutações locais em uma rodada após 1.500 ms", async () => {
    const manager = new SyncManager(ownerUid);
    await startAndReset(manager);

    dispatchEvent(new CustomEvent("gastos-sync-mutation", { detail: { ownerUid } }));
    await vi.advanceTimersByTimeAsync(500);
    dispatchEvent(new CustomEvent("gastos-sync-mutation", { detail: { ownerUid } }));
    await vi.advanceTimersByTimeAsync(500);
    dispatchEvent(new CustomEvent("gastos-sync-mutation", { detail: { ownerUid } }));
    await vi.advanceTimersByTimeAsync(SYNC_MUTATION_DEBOUNCE_MS - 1);
    expect(mocks.status).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(mocks.status).toHaveBeenCalledTimes(2);
    manager.stop();
  });

  it("faz no máximo uma rodada posterior quando chega mutação durante sync", async () => {
    const manager = new SyncManager(ownerUid);
    await startAndReset(manager);
    let release!: (value: typeof remoteStatus) => void;
    mocks.status.mockImplementationOnce(
      () => new Promise<typeof remoteStatus>((resolve) => (release = resolve)),
    );
    mocks.listOutbox.mockResolvedValue([{ id: "pending" }]);

    const first = manager.syncNow();
    await settle();
    dispatchEvent(new CustomEvent("gastos-sync-mutation", { detail: { ownerUid } }));
    release(remoteStatus);
    await first;
    await vi.advanceTimersByTimeAsync(SYNC_MUTATION_DEBOUNCE_MS);
    await settle();

    expect(mocks.status).toHaveBeenCalledTimes(4);
    manager.stop();
  });

  it("deduplica online e visibility e mantém o botão manual imediato", async () => {
    const manager = new SyncManager(ownerUid);
    await startAndReset(manager);

    dispatchEvent(new Event("online"));
    dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(250);
    await settle();
    expect(mocks.status).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    mocks.getSyncState.mockResolvedValue(localState);
    mocks.listOutbox.mockResolvedValue([]);
    mocks.listSyncConflicts.mockResolvedValue([]);
    mocks.status.mockResolvedValue(remoteStatus);
    mocks.pull.mockResolvedValue({ ...remoteStatus, cursor: 0, hasMore: false, records: [] });
    await manager.syncNow();
    expect(mocks.status).toHaveBeenCalledTimes(2);
    manager.stop();
  });

  it("não faz requests periódicos durante dois minutos de ociosidade", async () => {
    const manager = new SyncManager(ownerUid);
    await startAndReset(manager);

    await vi.advanceTimersByTimeAsync(120_000);

    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.pull).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    manager.stop();
  });

  it("duas instâncias não duplicam push do mesmo owner", async () => {
    const first = new SyncManager(ownerUid);
    const second = new SyncManager(ownerUid);
    await startAndReset(first);
    await startAndReset(second);
    const entry = {
      id: "outbox-1",
      ownerUid,
      mutationId: "mutation-1",
      entityType: "category",
      recordId: "category-1",
      operation: "upsert",
      baseVersion: 0,
      payload: { id: "category-1", ownerUid, name: "Teste", type: "expense" },
      fingerprint: "fingerprint",
      createdAt: remoteStatus.serverTime,
    };
    let acknowledged = false;
    mocks.status.mockResolvedValue({ ...remoteStatus, canPush: true });
    mocks.listOutbox.mockImplementation(async () => (acknowledged ? [] : [entry]));
    mocks.calculatorEntriesForSync.mockResolvedValue([]);
    mocks.push.mockResolvedValue({
      protocolVersion: 1,
      batchId: "batch",
      syncEpoch: 1,
      committedRevision: 1,
      highWatermark: 1,
      serverTime: remoteStatus.serverTime,
      results: [{ mutationId: "mutation-1", status: "applied", records: [] }],
    });
    mocks.acknowledgePush.mockImplementation(async () => {
      acknowledged = true;
    });

    await Promise.all([first.syncNow(), second.syncNow()]);

    expect(mocks.push).toHaveBeenCalledTimes(1);
    first.stop();
    second.stop();
  });

  it("usa backoff após falha e para de tentar depois do sucesso", async () => {
    const manager = new SyncManager(ownerUid);
    await startAndReset(manager);
    vi.spyOn(Math, "random").mockReturnValue(0);
    mocks.status.mockRejectedValueOnce(new Error("network"));

    await manager.syncNow();
    expect(mocks.status).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(mocks.status).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mocks.status).toHaveBeenCalledTimes(3);
    manager.stop();
  });

  it("saveData mantém sync funcional sem loop de visibility", async () => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true },
    });
    const manager = new SyncManager(ownerUid);
    await startAndReset(manager);

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(SYNC_SAVE_DATA_VISIBILITY_MIN_INTERVAL_MS - 1);
    expect(mocks.status).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(500);
    await settle();
    expect(mocks.status).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SYNC_SAVE_DATA_VISIBILITY_MIN_INTERVAL_MS);
    expect(mocks.status).toHaveBeenCalledTimes(2);
    manager.stop();
  });
});
