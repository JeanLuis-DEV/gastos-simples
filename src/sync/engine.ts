import {
  acknowledgePush,
  applyRemotePage,
  calculatorEntriesForSync,
  discardOutboxEntries,
  getSyncState,
  listOutbox,
  listSyncConflicts,
  prepareFullResync,
  replaceSyncState,
  updateSyncState,
} from "../storage/database";
import { syncApi, SyncHttpError, type PushOperation, type PushResponse } from "./client";
import { canUseRemoteSync } from "./config";
import { payloadForServer } from "./serialization";
import type { OutboxEntry, SyncUiStatus } from "./types";
import type { Backup } from "../storage/database";
import { SYNC_PRIVACY_POLICY_VERSION } from "../../shared/syncPolicy";

const LEASE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PUSH_BYTES = 256 * 1024;
export const SYNC_MUTATION_DEBOUNCE_MS = 1_500;
export const SYNC_ONLINE_DELAY_MS = 250;
export const SYNC_VISIBILITY_DELAY_MS = 500;
export const SYNC_VISIBILITY_MIN_INTERVAL_MS = 60_000;
export const SYNC_SAVE_DATA_VISIBILITY_MIN_INTERVAL_MS = 5 * 60_000;
const managers = new Map<string, SyncManager>();
const activeOwners = new Set<string>();

export type SyncSnapshot = {
  status: SyncUiStatus;
  enabled: boolean;
  available: boolean;
  canPush: boolean;
  lastSyncedAt?: string;
  error?: string;
  conflictCount: number;
};

const initialSnapshot: SyncSnapshot = { status: "disabled", enabled: false, available: false, canPush: false, conflictCount: 0 };

function messageFor(error: unknown) {
  if (!navigator.onLine) return "Sem conexão. As alterações continuam salvas neste dispositivo.";
  if (error instanceof SyncHttpError) return error.message;
  return "Não foi possível sincronizar agora. Seus dados locais continuam seguros.";
}

async function stableId(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  digest.forEach((item) => { binary += String.fromCharCode(item); });
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function hasValidOfflineLease(ownerUid: string, now = Date.now()) {
  const state = await getSyncState(ownerUid);
  if (!state.leaseDeadlineMs || !state.leaseObservedWallMs || now < state.leaseObservedWallMs || now > state.leaseDeadlineMs) return false;
  await replaceSyncState(ownerUid, { leaseObservedWallMs: now, leaseObservedMonotonicMs: performance.now() });
  return true;
}

export async function recordSuccessfulEntitlement(ownerUid: string, serverTime?: string) {
  const now = Date.now();
  const verifiedTime = serverTime ?? new Date(now).toISOString();
  const verifiedAt = Date.parse(verifiedTime);
  if (!Number.isFinite(verifiedAt) || Math.abs(verifiedAt - now) > 24 * 60 * 60 * 1000) throw new Error("A data deste dispositivo precisa ser corrigida para validar o acesso offline.");
  await replaceSyncState(ownerUid, {
    leaseValidatedAt: verifiedTime,
    leaseDeadlineMs: Math.min(now, verifiedAt) + LEASE_MS,
    leaseObservedWallMs: now,
    leaseObservedMonotonicMs: performance.now(),
  });
}

async function withOwnerLock<T>(ownerUid: string, action: () => Promise<T>): Promise<T | undefined> {
  if (activeOwners.has(ownerUid)) return undefined;
  activeOwners.add(ownerUid);
  try {
    if (navigator.locks?.request) {
      return await navigator.locks.request(`gastos-sync:${ownerUid}`, { ifAvailable: true }, async (lock) => lock ? action() : undefined);
    }
    return await action();
  } finally {
    activeOwners.delete(ownerUid);
  }
}

function wireEntries(entries: OutboxEntry[]) {
  const groups = new Map<string, OutboxEntry[]>();
  entries.forEach((entry) => groups.set(entry.mutationId, [...(groups.get(entry.mutationId) ?? []), entry]));
  const operations: PushOperation[] = [];
  const wired: OutboxEntry[] = [];
  for (const group of groups.values()) {
    group.sort((left, right) => `${left.entityType}:${left.recordId}`.localeCompare(`${right.entityType}:${right.recordId}`));
    const semantic = group.find((entry) => entry.semantic)?.semantic;
    if (semantic?.command === "delete-profile-and-transfer") {
      const profile = group.find((entry) => entry.entityType === "profile" && entry.operation === "delete");
      if (!profile) throw new Error("Operação local de perfil inválida.");
      operations.push({ command: semantic.command, mutationId: profile.mutationId, recordId: profile.recordId, destinationProfileId: semantic.destinationProfileId, baseVersion: profile.baseVersion });
      wired.push(...group);
      continue;
    }
    if (semantic?.command === "delete-series-future") {
      const series = group.find((entry) => entry.entityType === "series");
      if (!series) throw new Error("Operação local de série inválida.");
      operations.push({ command: semantic.command, mutationId: series.mutationId, entityType: "series", recordId: series.recordId, baseVersion: series.baseVersion, effectiveFrom: semantic.effectiveFrom });
      wired.push(...group);
      continue;
    }
    if (semantic?.command === "edit-series-future") {
      const series = group.find((entry) => entry.entityType === "series");
      const segment = group.find((entry) => entry.entityType === "seriesSegment" && String((entry.payload as { effectiveFrom?: string }).effectiveFrom) === semantic.effectiveFrom);
      if (!series || !segment) throw new Error("Operação local de série inválida.");
      const payload = payloadForServer("seriesSegment", segment.payload);
      const { seriesId: _seriesId, effectiveFrom: _effectiveFrom, ...changes } = payload;
      operations.push({ command: semantic.command, mutationId: series.mutationId, entityType: "series", recordId: series.recordId, baseVersion: series.baseVersion, effectiveFrom: semantic.effectiveFrom, changes });
      wired.push(...group);
      continue;
    }
    group.forEach((entry, index) => {
      const mutationId = group.length === 1 ? entry.mutationId : `${entry.mutationId}.${index}`;
      const operation: PushOperation = {
        command: entry.operation === "delete" ? "delete-record" : "upsert-record",
        mutationId,
        entityType: entry.entityType,
        recordId: entry.recordId,
        baseVersion: entry.baseVersion,
        ...(entry.operation === "upsert" ? { payload: payloadForServer(entry.entityType, entry.payload) } : {}),
        ...(entry.baseSnapshot ? { baseSnapshot: payloadForServer(entry.entityType, entry.baseSnapshot) } : {}),
      };
      operations.push(operation);
      wired.push({ ...entry, mutationId });
    });
  }
  return { operations, wired };
}

function nextPushChunk(entries: OutboxEntry[]) {
  const selected: OutboxEntry[] = [];
  const grouped = new Map<string, OutboxEntry[]>();
  for (const entry of entries) {
    grouped.set(entry.mutationId, [...(grouped.get(entry.mutationId) ?? []), entry]);
  }
  for (const group of grouped.values()) {
    if (selected.length && group.some((entry) => entry.semantic)) break;
    const candidate = [...selected, ...group];
    const { operations } = wireEntries(candidate);
    const bytes = new TextEncoder().encode(JSON.stringify({ protocolVersion: 1, syncEpoch: 1, batchId: "x".repeat(43), deviceId: "x".repeat(36), operations })).byteLength;
    if (operations.length > 100 || bytes > MAX_PUSH_BYTES) break;
    selected.push(...group);
    if (group.some((entry) => entry.semantic)) break;
  }
  return selected;
}

export class SyncManager {
  private snapshot: SyncSnapshot = initialSnapshot;
  private listeners = new Set<(snapshot: SyncSnapshot) => void>();
  private timer?: number;
  private timerReason?: "startup" | "mutation" | "online" | "visibility" | "retry";
  private syncInFlight?: Promise<void>;
  private mutationDuringSync = false;
  private manualDuringSync = false;
  private retryDelayAfterSync?: number;
  private lastSuccessfulSyncAt = 0;
  private failures = 0;
  private stopped = true;
  private channel?: BroadcastChannel;

  constructor(readonly ownerUid: string) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: (snapshot: SyncSnapshot) => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(changes: Partial<SyncSnapshot>) {
    this.snapshot = { ...this.snapshot, ...changes };
    this.listeners.forEach((listener) => listener(this.snapshot));
    this.channel?.postMessage({ type: "state", snapshot: this.snapshot });
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    if (!canUseRemoteSync()) return;
    this.channel = new BroadcastChannel(`gastos-sync:${this.ownerUid}`);
    this.channel.onmessage = (event) => { if (event.data?.type === "state") { this.snapshot = event.data.snapshot as SyncSnapshot; this.listeners.forEach((listener) => listener(this.snapshot)); } };
    addEventListener("online", this.onOnline);
    addEventListener("gastos-sync-mutation", this.onMutation as EventListener);
    document.addEventListener("visibilitychange", this.onVisibility);
    void this.refreshStatus().then(() => this.scheduleTrigger("startup", 0));
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.timerReason = undefined;
    removeEventListener("online", this.onOnline);
    removeEventListener("gastos-sync-mutation", this.onMutation as EventListener);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.channel?.close();
    this.channel = undefined;
  }

  private onOnline = () => this.scheduleTrigger("online", SYNC_ONLINE_DELAY_MS);
  private onMutation = (event: CustomEvent<{ ownerUid?: string }>) => {
    if (event.detail?.ownerUid !== this.ownerUid) return;
    if (this.syncInFlight) {
      this.mutationDuringSync = true;
      return;
    }
    this.scheduleTrigger("mutation", SYNC_MUTATION_DEBOUNCE_MS);
  };
  private onVisibility = () => {
    if (document.visibilityState === "visible") void this.scheduleVisibilitySync();
  };

  private async scheduleVisibilitySync() {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const minimumInterval = connection?.saveData
      ? SYNC_SAVE_DATA_VISIBILITY_MIN_INTERVAL_MS
      : SYNC_VISIBILITY_MIN_INTERVAL_MS;
    if (
      this.stopped ||
      this.syncInFlight ||
      this.timer !== undefined ||
      Date.now() - this.lastSuccessfulSyncAt < minimumInterval
    )
      return;
    const pending = await listOutbox(this.ownerUid);
    if (this.stopped || this.syncInFlight || this.timer !== undefined) return;
    if (pending.length || Date.now() - this.lastSuccessfulSyncAt >= minimumInterval)
      this.scheduleTrigger("visibility", SYNC_VISIBILITY_DELAY_MS);
  }

  private scheduleTrigger(
    reason: "startup" | "mutation" | "online" | "visibility" | "retry",
    delay: number,
  ) {
    if (this.stopped || !canUseRemoteSync()) return;
    if (this.syncInFlight) {
      if (reason === "mutation") this.mutationDuringSync = true;
      return;
    }
    if (this.timer !== undefined) {
      if (reason !== "mutation" && this.timerReason === "mutation") return;
      clearTimeout(this.timer);
    }
    this.timerReason = reason;
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      this.timerReason = undefined;
      void this.runSync(reason);
    }, delay);
  }

  /** Agenda somente uma alteração local já registrada atomicamente na outbox. */
  schedule(delay = SYNC_MUTATION_DEBOUNCE_MS) {
    this.scheduleTrigger("mutation", delay);
  }

  async refreshStatus() {
    if (!canUseRemoteSync()) return undefined;
    try {
      const remote = await syncApi.status();
      const local = await getSyncState(this.ownerUid);
      if (remote.canPush) await recordSuccessfulEntitlement(this.ownerUid, remote.serverTime);
      this.publish({ available: remote.available, enabled: local.enabled && remote.enabled, canPush: remote.canPush, lastSyncedAt: local.lastSyncedAt, status: local.enabled && remote.enabled ? "synced" : "disabled", error: undefined });
      return remote;
    } catch (error) {
      this.publish({ status: navigator.onLine ? "error" : "offline", error: messageFor(error) });
      return undefined;
    }
  }

  async activate(consentVersion = SYNC_PRIVACY_POLICY_VERSION) {
    if (!canUseRemoteSync()) throw new Error("A sincronização ainda não está disponível.");
    const state = await getSyncState(this.ownerUid);
    const remote = await syncApi.activate(state.deviceId, consentVersion);
    await replaceSyncState(this.ownerUid, { enabled: true, consentVersion, consentAcceptedAt: remote.consentAcceptedAt, epoch: remote.syncEpoch, cursor: 0, lastError: undefined });
    await recordSuccessfulEntitlement(this.ownerUid);
    this.publish({ enabled: true, available: true, canPush: true, status: "syncing" });
    await this.runSync("startup");
  }

  async disable(deleteRemoteData: boolean) {
    const response = await syncApi.disable(deleteRemoteData);
    await replaceSyncState(this.ownerUid, { enabled: false });
    this.publish({ enabled: false, status: "disabled" });
    return response;
  }

  async importSnapshot(backup: Backup, mode: "merge" | "replace") {
    const result = await syncApi.importRemote(backup, mode);
    await replaceSyncState(this.ownerUid, { epoch: result.syncEpoch, cursor: 0 });
    await this.runSync("startup");
  }

  async syncNow() {
    return this.runSync("manual");
  }

  private async runSync(
    reason: "startup" | "mutation" | "online" | "visibility" | "retry" | "manual",
  ) {
    if (this.syncInFlight) {
      if (reason === "mutation") this.mutationDuringSync = true;
      if (reason === "manual") this.manualDuringSync = true;
      return this.syncInFlight;
    }
    clearTimeout(this.timer);
    this.timer = undefined;
    this.timerReason = undefined;
    const current = this.performSync();
    this.syncInFlight = current;
    try {
      await current;
    } finally {
      this.syncInFlight = undefined;
      const manualFollowUp = this.manualDuringSync;
      const mutationFollowUp = this.mutationDuringSync;
      const retryDelay = this.retryDelayAfterSync;
      this.manualDuringSync = false;
      this.mutationDuringSync = false;
      this.retryDelayAfterSync = undefined;
      if (manualFollowUp) this.scheduleTrigger("startup", 0);
      else if (mutationFollowUp && (await listOutbox(this.ownerUid)).length)
        this.scheduleTrigger("mutation", SYNC_MUTATION_DEBOUNCE_MS);
      else if (retryDelay !== undefined) this.scheduleTrigger("retry", retryDelay);
    }
  }

  private async performSync() {
    if (!canUseRemoteSync() || this.stopped || !navigator.onLine) {
      if (!navigator.onLine) this.publish({ status: "offline" });
      return;
    }
    return withOwnerLock(this.ownerUid, async () => {
      const local = await getSyncState(this.ownerUid);
      if (!local.enabled) return;
      this.publish({ status: "syncing", error: undefined });
      try {
        const status = await syncApi.status();
        if (!status.available || !status.enabled) {
          await replaceSyncState(this.ownerUid, { enabled: false });
          this.publish({ enabled: false, available: status.available, status: "disabled" });
          return;
        }
        if (status.canPush) await recordSuccessfulEntitlement(this.ownerUid, status.serverTime);
        let state = await getSyncState(this.ownerUid);
        if (state.epoch !== status.syncEpoch) state = await replaceSyncState(this.ownerUid, { epoch: status.syncEpoch, cursor: 0 });
        let cursor = state.cursor;
        const highWatermark = status.highWatermark;
        do {
          const page = await syncApi.pull({ cursor, untilRevision: highWatermark, epoch: status.syncEpoch, deviceId: state.deviceId });
          await applyRemotePage(this.ownerUid, page.records, { cursor: page.cursor, epoch: page.syncEpoch, serverTime: page.serverTime });
          cursor = page.cursor;
          if (!page.hasMore) break;
        } while (cursor < highWatermark);
        if (status.canPush) await this.flushOutbox(state.deviceId);
        const refreshed = await syncApi.status();
        if (refreshed.highWatermark > cursor) {
          let pullCursor = cursor;
          do {
            const page = await syncApi.pull({ cursor: pullCursor, untilRevision: refreshed.highWatermark, epoch: refreshed.syncEpoch, deviceId: state.deviceId });
            await applyRemotePage(this.ownerUid, page.records, { cursor: page.cursor, epoch: page.syncEpoch, serverTime: page.serverTime });
            pullCursor = page.cursor;
            if (!page.hasMore) break;
          } while (pullCursor < refreshed.highWatermark);
        }
        const conflicts = await listSyncConflicts(this.ownerUid);
        const completedAt = new Date().toISOString();
        await updateSyncState(this.ownerUid, { lastSyncedAt: completedAt, lastError: undefined });
        this.failures = 0;
        this.lastSuccessfulSyncAt = Date.now();
        this.publish({ enabled: true, available: true, canPush: status.canPush, lastSyncedAt: completedAt, conflictCount: conflicts.length, status: conflicts.length ? "conflicts" : "synced" });
      } catch (error) {
        if (error instanceof SyncHttpError && error.code === "resync_required") await prepareFullResync(this.ownerUid);
        this.failures += 1;
        const errorMessage = messageFor(error);
        await updateSyncState(this.ownerUid, { lastError: errorMessage });
        this.publish({ status: navigator.onLine ? "error" : "offline", error: errorMessage });
        const base = Math.min(60_000, 1_000 * 2 ** Math.min(this.failures, 6));
        this.retryDelayAfterSync = base / 2 + Math.random() * base / 2;
      }
    });
  }

  private async flushOutbox(deviceId: string) {
    while (true) {
      let entries = (await listOutbox(this.ownerUid)).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
      if (!entries.length) return;
      const allowedCalculatorIds = new Set((await calculatorEntriesForSync(this.ownerUid)).map((item) => item.id));
      const ignored = entries.filter((entry) => entry.entityType === "calculator" && entry.operation === "upsert" && !allowedCalculatorIds.has(entry.recordId));
      await discardOutboxEntries(this.ownerUid, ignored.map((entry) => entry.id));
      entries = entries.filter((entry) => !ignored.includes(entry));
      if (!entries.length) return;
      const chunk = nextPushChunk(entries);
      if (!chunk.length) throw new Error("Uma alteração local excede o limite de sincronização.");
      const { operations, wired } = wireEntries(chunk);
      const state = await getSyncState(this.ownerUid);
      const batchId = await stableId({ epoch: state.epoch, operations });
      const response: PushResponse = await syncApi.push({ syncEpoch: state.epoch, batchId, deviceId, operations });
      await acknowledgePush(this.ownerUid, wired, response);
      await updateSyncState(this.ownerUid, { epoch: response.syncEpoch });
    }
  }
}

export function getSyncManager(ownerUid: string) {
  const existing = managers.get(ownerUid);
  if (existing) return existing;
  const manager = new SyncManager(ownerUid);
  managers.set(ownerUid, manager);
  return manager;
}

export function releaseSyncManager(ownerUid: string) {
  managers.get(ownerUid)?.stop();
  managers.delete(ownerUid);
}

export async function invalidateSyncLease(ownerUid: string) {
  await replaceSyncState(ownerUid, { leaseValidatedAt: undefined, leaseDeadlineMs: undefined, leaseObservedWallMs: undefined, leaseObservedMonotonicMs: undefined });
}
