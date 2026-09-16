import { getPublicConfig } from "../config";
import { getIdToken } from "../services/auth";
import { canUseRemoteSync, SYNC_PROTOCOL_VERSION } from "./config";
import type { RemoteRecord, SyncEntityType } from "./types";
import { payloadFromServer } from "./serialization";
import { payloadForServer } from "./serialization";
import type { Backup } from "../storage/database";
import type { SyncPayload } from "./types";

export class SyncHttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

async function syncRequest<T>(path: string, init: RequestInit = {}, retryAuth = true): Promise<T> {
  if (!canUseRemoteSync()) throw new SyncHttpError(503, "A sincronização ainda não está disponível.", "disabled");
  const token = await getIdToken(false);
  const response = await fetch(`${getPublicConfig().apiBaseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers },
  });
  if (response.status === 401 && retryAuth) {
    const refreshed = await getIdToken(true);
    const retried = await fetch(`${getPublicConfig().apiBaseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${refreshed}`, ...init.headers },
    });
    return parseResponse<T>(retried);
  }
  return parseResponse<T>(response);
}

async function parseResponse<T>(response: Response) {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    const code = body.error === "resync_required" ? "resync_required" : undefined;
    throw new SyncHttpError(response.status, code ? "Este dispositivo precisa baixar novamente os dados sincronizados." : body.error || "Não foi possível sincronizar agora.", code);
  }
  return body;
}

async function retryAfterTransportFailure<T>(action: () => Promise<T>) {
  try { return await action(); }
  catch (error) {
    if (error instanceof SyncHttpError) throw error;
    return action();
  }
}

export type SyncStatusResponse = {
  protocolVersion: 1;
  available: boolean;
  enabled: boolean;
  syncEpoch: number;
  highWatermark: number;
  minAvailableRevision: number;
  canPush: boolean;
  canPull: boolean;
  canExport: boolean;
  canDelete: boolean;
  serverTime: string;
};

export type PushOperation = {
  command: "upsert-record" | "delete-record";
  mutationId: string;
  entityType: SyncEntityType;
  recordId: string;
  baseVersion: number;
  payload?: Record<string, unknown>;
  baseSnapshot?: Record<string, unknown>;
} | {
  command: "edit-series-future" | "delete-series-future";
  mutationId: string;
  entityType: "series";
  recordId: string;
  baseVersion: number;
  effectiveFrom: string;
  changes?: Record<string, unknown>;
} | {
  command: "delete-profile-and-transfer";
  mutationId: string;
  recordId: string;
  destinationProfileId: string;
  baseVersion: number;
};

export type PushResponse = {
  protocolVersion: 1;
  batchId: string;
  syncEpoch: number;
  committedRevision: number;
  highWatermark: number;
  serverTime: string;
  results: Array<{
    mutationId: string;
    status: "applied" | "merged" | "conflict" | "remote_deleted" | "aliased" | "already_applied";
    records?: Array<{ entityType: SyncEntityType; recordId: string; version: number; revision: number; isDeleted: boolean }>;
    conflictId?: string;
    conflictingFields?: string[];
    canonicalRecordId?: string;
  }>;
};

export const syncApi = {
  status: () => syncRequest<SyncStatusResponse>("/sync/status"),
  activate: (deviceId: string, consentVersion: number) => syncRequest<{ enabled: true; syncEpoch: number; highWatermark: number; consentAcceptedAt: string }>("/sync/activate", { method: "POST", body: JSON.stringify({ protocolVersion: SYNC_PROTOCOL_VERSION, deviceId, consentVersion }) }),
  pull: (input: { cursor: number; untilRevision?: number; limit?: number; epoch: number; deviceId: string }) => {
    const query = new URLSearchParams({ cursor: String(input.cursor), limit: String(input.limit ?? 200), epoch: String(input.epoch), deviceId: input.deviceId, protocolVersion: String(SYNC_PROTOCOL_VERSION) });
    if (input.untilRevision !== undefined) query.set("untilRevision", String(input.untilRevision));
    return syncRequest<{ protocolVersion: 1; syncEpoch: number; highWatermark: number; cursor: number; hasMore: boolean; minAvailableRevision: number; serverTime: string; records: RemoteRecord[] }>(`/sync/pull?${query}`);
  },
  push: (input: { syncEpoch: number; batchId: string; deviceId: string; operations: PushOperation[] }) => syncRequest<PushResponse>("/sync/push", { method: "POST", body: JSON.stringify({ protocolVersion: SYNC_PROTOCOL_VERSION, ...input }) }),
  disable: (deleteRemoteData: boolean) => syncRequest<{ enabled: false; deletionRequired: boolean }>("/sync/disable", { method: "POST", body: JSON.stringify({ deleteRemoteData }) }),
  exportRemote: async (ownerUid: string) => {
    let cursor = 0;
    let highWatermark: number | undefined;
    let exportedAt = new Date().toISOString();
    const data: Record<SyncEntityType, unknown[]> = { transaction: [], category: [], calculator: [], profile: [], series: [], seriesSegment: [] };
    do {
      const query = new URLSearchParams({ cursor: String(cursor), limit: "200" });
      if (highWatermark !== undefined) query.set("untilRevision", String(highWatermark));
      const page = await syncRequest<{ exportedAt: string; highWatermark: number; cursor: number; hasMore: boolean; records: RemoteRecord[] }>(`/data/export?${query}`);
      highWatermark = page.highWatermark;
      exportedAt = page.exportedAt;
      for (const record of page.records) {
        if (record.isDeleted) continue;
        data[record.entityType].push(payloadFromServer(record.entityType, record.recordId, ownerUid, record.payload, { ...record, serverTime: exportedAt }));
      }
      if (page.cursor === cursor && page.hasMore) throw new Error("A exportação remota não pôde avançar.");
      cursor = page.cursor;
      if (!page.hasMore) break;
    } while (cursor < (highWatermark ?? 0));
    return {
      schemaVersion: 4,
      app: "Gastos Simples",
      ownerUid,
      exportedAt,
      transactions: data.transaction,
      categories: data.category,
      calculator: data.calculator,
      profiles: data.profile,
      series: data.series,
      seriesSegments: data.seriesSegment,
      preferences: { theme: "dark", confirmBeforeDelete: true, selectedProfileId: "" },
    };
  },
  deletionIntent: () => syncRequest<{ nonce: string; expiresAt: string }>("/data/deletion-intent", { method: "POST", body: "{}" }),
  deleteRemote: (nonce: string) => syncRequest<{ deleted: true; syncEpoch: number }>("/data", { method: "DELETE", body: JSON.stringify({ nonce }) }),
  importRemote: async (backup: Backup, mode: "merge" | "replace") => {
    const status = await syncRequest<SyncStatusResponse>("/sync/status");
    const started = await syncRequest<{ sessionId: string; nextChunk: number }>("/data/import/start", { method: "POST", body: JSON.stringify({ mode, baseRevision: status.highWatermark }) });
    const collections: Array<[SyncEntityType, SyncPayload[]]> = [
      ["profile", backup.profiles], ["category", backup.categories], ["series", backup.series], ["seriesSegment", backup.seriesSegments], ["transaction", backup.transactions],
      ["calculator", [...backup.calculator].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 100)],
    ];
    const records = collections.flatMap(([entityType, values]) => values.map((value) => ({ entityType, recordId: value.id, payload: payloadForServer(entityType, value) })));
    let chunkIndex = 0;
    try {
      for (let offset = 0; offset < records.length;) {
        const chunk = [];
        while (offset < records.length && chunk.length < 100) {
          const candidate = [...chunk, records[offset]!];
          const bytes = new TextEncoder().encode(JSON.stringify({ sessionId: started.sessionId, chunkIndex, records: candidate })).byteLength;
          if (bytes > 256 * 1024) break;
          chunk.push(records[offset]!);
          offset += 1;
        }
        if (!chunk.length) throw new Error("Um registro do backup excede o limite de importação.");
        const chunkBody = JSON.stringify({ sessionId: started.sessionId, chunkIndex, records: chunk });
        await retryAfterTransportFailure(() => syncRequest("/data/import/chunk", { method: "POST", body: chunkBody }));
        chunkIndex += 1;
      }
      const commitBody = JSON.stringify({ sessionId: started.sessionId });
      return await retryAfterTransportFailure(() => syncRequest<{ committed: true; syncEpoch: number; highWatermark: number }>("/data/import/commit", { method: "POST", body: commitBody }));
    } catch (error) {
      await syncRequest("/data/import/abort", { method: "POST", body: JSON.stringify({ sessionId: started.sessionId }) }).catch(() => undefined);
      throw error;
    }
  },
};
