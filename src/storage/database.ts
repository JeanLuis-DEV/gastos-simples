import { isValidCivilDate } from "../domain/dates";
import type { CalculatorEntry, Category, FinancialProfile, ThemePreference, Transaction, TransactionKind, TransactionSeries, TransactionSeriesSegment, TransactionStatus, TransactionType } from "../domain/models";
import { DEFAULT_CATEGORIES } from "../domain/models";
import type { OutboxEntry, SyncBaseSnapshot, SyncConflict, SyncEntityType, SyncPayload, SyncState } from "../sync/types";
import type { RemoteRecord } from "../sync/types";
import { payloadForServer, payloadFromServer, sameServerPayload } from "../sync/serialization";

const DB_NAME = "gastos-simples";
const DB_VERSION = 3;
type StoreName = "transactions" | "categories" | "calculator" | "preferences" | "profiles" | "series" | "seriesSegments";
const SYNC_STORES = ["syncOutbox", "syncState", "syncBaseSnapshots", "syncConflicts"] as const;
const principalId = (uid: string) => `profile:principal:${uid}`;
const nameKey = (name: string) => name.trim().toLocaleLowerCase("pt-BR");
const mutationNotifications = new WeakSet<IDBTransaction>();
export const categoryCanonicalKey = (category: Pick<Category, "name" | "type">) =>
  `${category.type}:${nameKey(category.name).normalize("NFD").replace(/[\u0300-\u036f]/g, "")}`;

const entityByStore: Partial<Record<StoreName, SyncEntityType>> = {
  transactions: "transaction",
  categories: "category",
  calculator: "calculator",
  profiles: "profile",
  series: "series",
  seriesSegments: "seriesSegment",
};

function syncRecord<T extends { id: string; ownerUid: string; localVersion?: number; serverVersion?: number }>(item: T, previous?: T): T {
  return {
    ...item,
    localVersion: Math.max(previous?.localVersion ?? 0, item.localVersion ?? 0) + 1,
    serverVersion: item.serverVersion ?? previous?.serverVersion ?? 0,
  };
}

function outboxId(ownerUid: string, mutationId: string, entityType: SyncEntityType, recordId: string) {
  return `${ownerUid}:${mutationId}:${entityType}:${recordId}`;
}

function syncFingerprint(entityType: SyncEntityType, operation: "upsert" | "delete", payload: SyncPayload) {
  const { localVersion: _localVersion, serverVersion: _serverVersion, serverRevision: _serverRevision, deletedAt: _deletedAt, ...domain } = payload;
  return JSON.stringify({ entityType, recordId: payload.id, operation, payload: domain });
}

function enqueueChange(
  tx: IDBTransaction,
  entityType: SyncEntityType,
  next: SyncPayload,
  previous: SyncPayload | undefined,
  operation: "upsert" | "delete",
  mutationId: string,
  semantic?: OutboxEntry["semantic"],
) {
  if (!mutationNotifications.has(tx)) {
    mutationNotifications.add(tx);
    tx.addEventListener("complete", () => globalThis.dispatchEvent(new CustomEvent("gastos-sync-mutation", { detail: { ownerUid: next.ownerUid } })), { once: true });
  }
  const fingerprint = syncFingerprint(entityType, operation, next);
  const id = outboxId(next.ownerUid, mutationId, entityType, next.id);
  const store = tx.objectStore("syncOutbox");
  const request = store.get(id);
  request.onsuccess = () => {
    const existing = request.result as OutboxEntry | undefined;
    if (existing && existing.fingerprint !== fingerprint) {
      tx.abort();
      return;
    }
    if (!existing) {
      try {
        store.put({
          id,
          ownerUid: next.ownerUid,
          mutationId,
          entityType,
          recordId: next.id,
          operation,
          baseVersion: previous?.serverVersion ?? 0,
          payload: next,
          baseSnapshot: previous,
          fingerprint,
          createdAt: new Date().toISOString(),
          semantic,
        } satisfies OutboxEntry);
      } catch {
        tx.abort();
      }
    }
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const upgrade = request.transaction!;
      if (!db.objectStoreNames.contains("transactions")) {
        const store = db.createObjectStore("transactions", { keyPath: "id" });
        store.createIndex("ownerUid", "ownerUid");
        store.createIndex("ownerMonth", ["ownerUid", "dueDate"]);
      }
      const transactionIndexes = upgrade.objectStore("transactions");
      if (!transactionIndexes.indexNames.contains("ownerOccurrence"))
        transactionIndexes.createIndex("ownerOccurrence", ["ownerUid", "occurrenceKey"]);
      if (!db.objectStoreNames.contains("categories")) {
        const store = db.createObjectStore("categories", { keyPath: "id" });
        store.createIndex("ownerUid", "ownerUid");
      }
      if (!db.objectStoreNames.contains("calculator")) {
        const store = db.createObjectStore("calculator", { keyPath: "id" });
        store.createIndex("ownerUid", "ownerUid");
      }
      if (!db.objectStoreNames.contains("preferences")) db.createObjectStore("preferences", { keyPath: "id" });
      const profiles = db.objectStoreNames.contains("profiles")
        ? upgrade.objectStore("profiles")
        : db.createObjectStore("profiles", { keyPath: "id" });
      if (!profiles.indexNames.contains("ownerUid")) profiles.createIndex("ownerUid", "ownerUid");
      for (const storeName of ["series", "seriesSegments"] as const) {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: "id" });
          store.createIndex("ownerUid", "ownerUid");
          if (storeName === "seriesSegments") store.createIndex("ownerSeries", ["ownerUid", "seriesId"]);
        }
      }
      if (!db.objectStoreNames.contains("syncOutbox")) {
        const store = db.createObjectStore("syncOutbox", { keyPath: "id" });
        store.createIndex("ownerUid", "ownerUid");
        store.createIndex("ownerCreated", ["ownerUid", "createdAt"]);
      }
      if (!db.objectStoreNames.contains("syncState")) db.createObjectStore("syncState", { keyPath: "ownerUid" });
      for (const storeName of ["syncBaseSnapshots", "syncConflicts"] as const) {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: "id" });
          store.createIndex("ownerUid", "ownerUid");
        }
      }
      if ((event.oldVersion ?? 0) < 2) {
        const timestamp = new Date().toISOString();
        const ensure = (uid: string) => {
          if (!uid) return "";
          const id = principalId(uid);
          profiles.put({ id, ownerUid: uid, name: "Principal", createdAt: timestamp, updatedAt: timestamp } satisfies FinancialProfile);
          return id;
        };
        for (const storeName of ["categories", "calculator"] as const) {
          upgrade.objectStore(storeName).openCursor().onsuccess = (cursorEvent) => {
            const cursor = (cursorEvent.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (!cursor) return;
            ensure(String((cursor.value as { ownerUid?: unknown }).ownerUid ?? ""));
            cursor.continue();
          };
        }
        upgrade.objectStore("transactions").openCursor().onsuccess = (cursorEvent) => {
          const cursor = (cursorEvent.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor) return;
          const value = cursor.value as Transaction;
          const id = ensure(value.ownerUid);
          if (!value.profileId && id) cursor.update({ ...value, profileId: id });
          cursor.continue();
        };
      }
      if ((event.oldVersion ?? 0) < 3) {
        const normalizeStore = (storeName: "transactions" | "categories" | "calculator" | "profiles") => {
          const request = upgrade.objectStore(storeName).openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            const value = cursor.value as SyncPayload;
            const common = { ...value, localVersion: Math.max(value.localVersion ?? 0, 1), serverVersion: value.serverVersion ?? 0 };
            if (storeName === "transactions") {
              const item = common as Transaction;
              const occurrenceKey = item.kind === "single"
                ? `single:${item.id}`
                : item.kind === "recurring" && item.seriesId
                  ? `${item.seriesId}:${item.dueDate.slice(0, 7)}`
                  : item.seriesId && item.installmentCurrent
                    ? `${item.seriesId}:${item.installmentCurrent}`
                    : item.occurrenceKey;
              cursor.update({ ...item, profileId: item.profileId || principalId(item.ownerUid), occurrenceKey });
            } else if (storeName === "categories") {
              const item = common as Category;
              cursor.update({ ...item, canonicalKey: categoryCanonicalKey(item) });
            } else cursor.update(common);
            cursor.continue();
          };
        };
        (["transactions", "categories", "calculator", "profiles"] as const).forEach(normalizeStore);
        const allTransactions = upgrade.objectStore("transactions").getAll();
        allTransactions.onsuccess = () => {
          const timestamp = new Date().toISOString();
          const groups = new Map<string, Transaction[]>();
          for (const item of allTransactions.result as Transaction[]) {
            if (!item.seriesId || item.kind === "single") continue;
            const group = groups.get(item.seriesId) ?? [];
            group.push(item);
            groups.set(item.seriesId, group);
          }
          for (const [seriesId, items] of groups) {
            items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
            const first = items[0]!;
            const updatedAt = items.map((item) => item.updatedAt).sort().at(-1) ?? timestamp;
            upgrade.objectStore("series").put({
              id: seriesId,
              ownerUid: first.ownerUid,
              kind: first.kind as "recurring" | "installment",
              startDate: first.dueDate,
              endBefore: items.map((item) => item.seriesEndDate).filter(Boolean).sort()[0],
              installmentTotal: first.installmentTotal,
              createdAt: first.createdAt,
              updatedAt,
              localVersion: 1,
              serverVersion: 0,
              isDeleted: false,
            } satisfies TransactionSeries);
            upgrade.objectStore("seriesSegments").put({
              id: `segment:${seriesId}:${first.dueDate}`,
              ownerUid: first.ownerUid,
              seriesId,
              effectiveFrom: first.dueDate,
              anchorDueDate: first.dueDate,
              profileId: first.profileId || principalId(first.ownerUid),
              description: first.description,
              amountCents: first.amountCents,
              type: first.type,
              categoryId: first.categoryId,
              categoryName: first.categoryName,
              notes: first.notes,
              createdAt: first.createdAt,
              updatedAt,
              localVersion: 1,
              serverVersion: 0,
              isDeleted: false,
            } satisfies TransactionSeriesSegment);
          }
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Não foi possível abrir o armazenamento local."));
    request.onblocked = () => reject(new Error("Feche outras abas do Gastos Simples e tente novamente."));
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Falha no armazenamento local."));
  });
}
const done = (tx: IDBTransaction, message = "Falha ao salvar os dados.") => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = tx.onerror = () => reject(new Error(message));
});

async function assertAvailableOccurrence(store: IDBObjectStore, item: Transaction) {
  if (item.isDeleted === true) return;
  const matches = await result<Transaction[]>(store.index("ownerOccurrence").getAll([item.ownerUid, item.occurrenceKey]));
  if (matches.some((match) => match.id !== item.id && match.isDeleted !== true))
    throw new Error("Já existe um lançamento para esta ocorrência.");
}

export class LocalRepository<T extends { id: string; ownerUid: string }> {
  constructor(private readonly storeName: StoreName, private readonly includeDeleted = false) {}
  async list(ownerUid: string, includeDeleted = this.includeDeleted): Promise<T[]> {
    const db = await openDatabase();
    const items = await result<T[]>(db.transaction(this.storeName).objectStore(this.storeName).index("ownerUid").getAll(ownerUid));
    return includeDeleted ? items : items.filter((item) => (item as T & { isDeleted?: boolean }).isDeleted !== true);
  }
  async put(item: T, mutationId: string = crypto.randomUUID()): Promise<void> {
    const db = await openDatabase();
    const entityType = entityByStore[this.storeName];
    if (!entityType) throw new Error("Armazenamento não sincronizável.");
    const tx = db.transaction([this.storeName, "syncOutbox"], "readwrite");
    const store = tx.objectStore(this.storeName);
    const previous = await result<T | undefined>(store.get(item.id));
    if (previous && previous.ownerUid !== item.ownerUid) {
      tx.abort();
      throw new Error("Identificador pertencente a outra conta.");
    }
    if (this.storeName === "transactions") await assertAvailableOccurrence(store, item as unknown as Transaction);
    const outboxStore = tx.objectStore("syncOutbox");
    const id = outboxId(item.ownerUid, mutationId, entityType, item.id);
    const existingMutation = await result<OutboxEntry | undefined>(outboxStore.get(id));
    const operation = (item as T & { isDeleted?: boolean }).isDeleted ? "delete" : "upsert";
    const expectedFingerprint = syncFingerprint(entityType, operation, item as unknown as SyncPayload);
    if (existingMutation) {
      if (existingMutation.fingerprint !== expectedFingerprint) {
        tx.abort();
        throw new Error("A chave idempotente já foi usada por outra alteração.");
      }
      return;
    }
    const next = syncRecord(item, previous) as T;
    store.put(next);
    enqueueChange(tx, entityType, next as unknown as SyncPayload, previous as unknown as SyncPayload | undefined, operation, mutationId);
    await done(tx);
  }
  async putMany(items: T[], mutationId: string = crypto.randomUUID()): Promise<void> {
    if (!items.length) return;
    const db = await openDatabase();
    const entityType = entityByStore[this.storeName];
    if (!entityType) throw new Error("Armazenamento não sincronizável.");
    const tx = db.transaction([this.storeName, "syncOutbox"], "readwrite");
    const store = tx.objectStore(this.storeName);
    for (const item of items) {
      const previous = await result<T | undefined>(store.get(item.id));
      if (previous && previous.ownerUid !== item.ownerUid) {
        tx.abort();
        throw new Error("Identificador pertencente a outra conta.");
      }
      if (this.storeName === "transactions") await assertAvailableOccurrence(store, item as unknown as Transaction);
      const operation = (item as T & { isDeleted?: boolean }).isDeleted ? "delete" : "upsert";
      const id = outboxId(item.ownerUid, mutationId, entityType, item.id);
      const existingMutation = await result<OutboxEntry | undefined>(tx.objectStore("syncOutbox").get(id));
      const expectedFingerprint = syncFingerprint(entityType, operation, item as unknown as SyncPayload);
      if (existingMutation) {
        if (existingMutation.fingerprint !== expectedFingerprint) {
          tx.abort();
          throw new Error("A chave idempotente já foi usada por outra alteração.");
        }
        continue;
      }
      const next = syncRecord(item, previous) as T;
      store.put(next);
      enqueueChange(tx, entityType, next as unknown as SyncPayload, previous as unknown as SyncPayload | undefined, operation, mutationId);
    }
    await done(tx);
  }
  async delete(id: string, ownerUid: string): Promise<T | undefined> {
    const db = await openDatabase();
    const entityType = entityByStore[this.storeName];
    if (!entityType) throw new Error("Armazenamento não sincronizável.");
    const tx = db.transaction([this.storeName, "syncOutbox"], "readwrite");
    const store = tx.objectStore(this.storeName);
    const item = await result<T | undefined>(store.get(id));
    if (!item || item.ownerUid !== ownerUid) return undefined;
    const now = new Date().toISOString();
    const tombstone = syncRecord({ ...item, isDeleted: true, deletedAt: now } as T, item);
    store.put(tombstone);
    enqueueChange(tx, entityType, tombstone as unknown as SyncPayload, item as unknown as SyncPayload, "delete", crypto.randomUUID());
    await done(tx);
    return item;
  }
  async clear(ownerUid: string): Promise<void> {
    const items = await this.list(ownerUid, true);
    if (!items.length) return;
    const db = await openDatabase();
    const entityType = entityByStore[this.storeName];
    if (!entityType) throw new Error("Armazenamento não sincronizável.");
    const tx = db.transaction([this.storeName, "syncOutbox"], "readwrite");
    const mutationId = crypto.randomUUID();
    const now = new Date().toISOString();
    items.forEach((item) => {
      const tombstone = syncRecord({ ...item, isDeleted: true, deletedAt: now } as T, item);
      tx.objectStore(this.storeName).put(tombstone);
      enqueueChange(tx, entityType, tombstone as unknown as SyncPayload, item as unknown as SyncPayload, "delete", mutationId);
    });
    await done(tx);
  }
}

export const transactionsRepository = new LocalRepository<Transaction>("transactions");
export const categoriesRepository = new LocalRepository<Category>("categories");
export const calculatorRepository = new LocalRepository<CalculatorEntry>("calculator");
export const profilesRepository = new LocalRepository<FinancialProfile>("profiles");
export const seriesRepository = new LocalRepository<TransactionSeries>("series");
export const seriesSegmentsRepository = new LocalRepository<TransactionSeriesSegment>("seriesSegments");

export async function putTransactionsAtomic(
  items: Transaction[],
  options: { mutationId?: string; segmentFrom?: string; endSeriesBefore?: string; clearSeriesEnd?: boolean } = {},
) {
  if (!items.length) return;
  if (items.every((item) => !item.seriesId || item.kind === "single")) {
    await transactionsRepository.putMany(items, options.mutationId);
    return;
  }
  const ownerUid = items[0]!.ownerUid;
  if (items.some((item) => item.ownerUid !== ownerUid))
    throw new Error("Uma operação não pode misturar contas.");
  const db = await openDatabase();
  const tx = db.transaction(["transactions", "series", "seriesSegments", "syncOutbox"], "readwrite");
  const mutationId = options.mutationId ?? crypto.randomUUID();
  const existingMutation = (await result<OutboxEntry[]>(tx.objectStore("syncOutbox").index("ownerUid").getAll(ownerUid)))
    .filter((entry) => entry.mutationId === mutationId);
  if (existingMutation.length) {
    const transactionEntries = existingMutation.filter((entry) => entry.entityType === "transaction");
    const isSameMutation = transactionEntries.length === items.length && items.every((item) => {
      const operation = item.isDeleted ? "delete" : "upsert";
      return transactionEntries.some((entry) =>
        entry.recordId === item.id && entry.fingerprint === syncFingerprint("transaction", operation, item));
    });
    if (!isSameMutation) {
      tx.abort();
      throw new Error("A chave idempotente já foi usada por outra alteração.");
    }
    await done(tx);
    return;
  }
  const transactionStore = tx.objectStore("transactions");
  for (const item of items) {
    const previous = await result<Transaction | undefined>(transactionStore.get(item.id));
    if (previous && previous.ownerUid !== ownerUid) {
      tx.abort();
      throw new Error("Identificador pertencente a outra conta.");
    }
    await assertAvailableOccurrence(transactionStore, item);
    const next = syncRecord(item, previous);
    transactionStore.put(next);
    enqueueChange(tx, "transaction", next, previous, next.isDeleted ? "delete" : "upsert", mutationId);
  }
  const grouped = new Map<string, Transaction[]>();
  for (const item of items) {
    if (!item.seriesId || item.kind === "single") continue;
    const group = grouped.get(item.seriesId) ?? [];
    group.push(item);
    grouped.set(item.seriesId, group);
  }
  for (const [seriesId, values] of grouped) {
    values.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const first = values[0]!;
    const seriesStore = tx.objectStore("series");
    const previousSeries = await result<TransactionSeries | undefined>(seriesStore.get(seriesId));
    if (previousSeries && previousSeries.ownerUid !== ownerUid) {
      tx.abort();
      throw new Error("Série pertencente a outra conta.");
    }
    const requestedEndBefore = options.clearSeriesEnd
      ? undefined
      : options.endSeriesBefore ?? values.map((item) => item.seriesEndDate).filter((value): value is string => Boolean(value)).sort()[0] ?? previousSeries?.endBefore;
    const seriesChanged = !previousSeries || previousSeries.kind !== first.kind || previousSeries.endBefore !== requestedEndBefore || previousSeries.installmentTotal !== (first.installmentTotal ?? previousSeries.installmentTotal);
    const mutationUpdatedAt = values.map((item) => item.updatedAt).sort().at(-1) ?? new Date().toISOString();
    const updatedAt = seriesChanged
      ? mutationUpdatedAt
      : previousSeries.updatedAt;
    const nextSeries = syncRecord({
      id: seriesId,
      ownerUid,
      kind: first.kind as "recurring" | "installment",
      startDate: previousSeries?.startDate ?? first.dueDate,
      endBefore: requestedEndBefore,
      installmentTotal: first.installmentTotal ?? previousSeries?.installmentTotal,
      createdAt: previousSeries?.createdAt ?? first.createdAt,
      updatedAt,
      isDeleted: previousSeries?.isDeleted ?? false,
      deletedAt: previousSeries?.deletedAt,
      serverVersion: previousSeries?.serverVersion ?? 0,
    }, previousSeries);
    if (seriesChanged || options.segmentFrom) {
      seriesStore.put(nextSeries);
      enqueueChange(tx, "series", nextSeries, previousSeries, nextSeries.isDeleted ? "delete" : "upsert", mutationId,
        options.endSeriesBefore ? { command: "delete-series-future", effectiveFrom: options.endSeriesBefore } : options.segmentFrom ? { command: "edit-series-future", effectiveFrom: options.segmentFrom } : undefined);
    }

    if (!previousSeries || options.segmentFrom) {
      const effectiveFrom = options.segmentFrom ?? first.dueDate;
      const template = values.find((item) => item.dueDate >= effectiveFrom) ?? first;
      const segmentId = `segment:${seriesId}:${effectiveFrom}`;
      const segmentStore = tx.objectStore("seriesSegments");
      const previousSegment = await result<TransactionSeriesSegment | undefined>(segmentStore.get(segmentId));
      const nextSegment = syncRecord({
        id: segmentId,
        ownerUid,
        seriesId,
        effectiveFrom,
        anchorDueDate: template.dueDate,
        profileId: template.profileId,
        description: template.description,
        amountCents: template.amountCents,
        type: template.type,
        categoryId: template.categoryId,
        categoryName: template.categoryName,
        notes: template.notes,
        createdAt: previousSegment?.createdAt ?? template.createdAt,
        updatedAt: mutationUpdatedAt,
        isDeleted: nextSeries.isDeleted,
        deletedAt: nextSeries.deletedAt,
        serverVersion: previousSegment?.serverVersion ?? 0,
      }, previousSegment);
      segmentStore.put(nextSegment);
      enqueueChange(tx, "seriesSegment", nextSegment, previousSegment, nextSegment.isDeleted ? "delete" : "upsert", mutationId);
    }
  }
  await done(tx);
}

export async function getSyncState(ownerUid: string): Promise<SyncState> {
  const db = await openDatabase();
  const current = await result<SyncState | undefined>(db.transaction("syncState").objectStore("syncState").get(ownerUid));
  if (current) return current;
  const state: SyncState = { ownerUid, deviceId: crypto.randomUUID(), cursor: 0, epoch: 0, enabled: false };
  await result(db.transaction("syncState", "readwrite").objectStore("syncState").put(state));
  return state;
}

export async function listOutbox(ownerUid: string) {
  const db = await openDatabase();
  return result<OutboxEntry[]>(db.transaction("syncOutbox").objectStore("syncOutbox").index("ownerUid").getAll(ownerUid));
}

export async function discardOutboxEntries(ownerUid: string, ids: string[]) {
  if (!ids.length) return;
  const db = await openDatabase();
  const tx = db.transaction("syncOutbox", "readwrite");
  for (const id of ids) {
    const entry = await result<OutboxEntry | undefined>(tx.objectStore("syncOutbox").get(id));
    if (entry?.ownerUid === ownerUid) tx.objectStore("syncOutbox").delete(id);
  }
  await done(tx);
}

export async function listSyncBaseSnapshots(ownerUid: string) {
  const db = await openDatabase();
  return result<SyncBaseSnapshot[]>(db.transaction("syncBaseSnapshots").objectStore("syncBaseSnapshots").index("ownerUid").getAll(ownerUid));
}

export async function listSyncConflicts(ownerUid: string) {
  const db = await openDatabase();
  return result<SyncConflict[]>(db.transaction("syncConflicts").objectStore("syncConflicts").index("ownerUid").getAll(ownerUid));
}

export async function putSyncBaseSnapshot(snapshot: SyncBaseSnapshot) {
  const expectedId = `${snapshot.ownerUid}:${snapshot.entityType}:${snapshot.recordId}`;
  if (snapshot.id !== expectedId || snapshot.payload.ownerUid !== snapshot.ownerUid || snapshot.payload.id !== snapshot.recordId)
    throw new Error("Snapshot-base inválido.");
  const db = await openDatabase();
  await result(db.transaction("syncBaseSnapshots", "readwrite").objectStore("syncBaseSnapshots").put(snapshot));
}

export async function putSyncConflict(conflict: SyncConflict) {
  const expectedId = `${conflict.ownerUid}:${conflict.mutationId}:${conflict.entityType}:${conflict.recordId}`;
  if (conflict.id !== expectedId || conflict.local.ownerUid !== conflict.ownerUid || conflict.remote.ownerUid !== conflict.ownerUid || conflict.local.id !== conflict.recordId || conflict.remote.id !== conflict.recordId || (conflict.base && (conflict.base.ownerUid !== conflict.ownerUid || conflict.base.id !== conflict.recordId)))
    throw new Error("Conflito inválido.");
  const db = await openDatabase();
  await result(db.transaction("syncConflicts", "readwrite").objectStore("syncConflicts").put(conflict));
}

export async function updateSyncState(ownerUid: string, changes: Partial<Omit<SyncState, "ownerUid" | "deviceId">>) {
  const current = await getSyncState(ownerUid);
  const next: SyncState = {
    ...current,
    ...changes,
    ownerUid,
    deviceId: current.deviceId,
    cursor: Math.max(current.cursor, changes.cursor ?? current.cursor),
    epoch: Math.max(current.epoch, changes.epoch ?? current.epoch),
  };
  const db = await openDatabase();
  await result(db.transaction("syncState", "readwrite").objectStore("syncState").put(next));
  return next;
}

export async function replaceSyncState(ownerUid: string, changes: Partial<Omit<SyncState, "ownerUid" | "deviceId">>) {
  const current = await getSyncState(ownerUid);
  const next: SyncState = { ...current, ...changes, ownerUid, deviceId: current.deviceId };
  const db = await openDatabase();
  await result(db.transaction("syncState", "readwrite").objectStore("syncState").put(next));
  return next;
}

export async function prepareFullResync(ownerUid: string) {
  const db = await openDatabase();
  const tx = db.transaction([...Object.values(storeByEntity), "syncOutbox", "syncState", "syncBaseSnapshots", "syncConflicts"], "readwrite");
  const outboxStore = tx.objectStore("syncOutbox");
  const pending = await result<OutboxEntry[]>(outboxStore.index("ownerUid").getAll(ownerUid));
  const pendingKeys = new Set(pending.map((entry) => `${entry.entityType}:${entry.recordId}`));
  for (const [entityType, storeName] of Object.entries(storeByEntity) as Array<[SyncEntityType, Exclude<StoreName, "preferences">]>) {
    const store = tx.objectStore(storeName);
    const records = await result<SyncPayload[]>(store.index("ownerUid").getAll(ownerUid));
    for (const record of records) {
      const pendingKey = pendingKeys.has(`${entityType}:${record.id}`);
      if ((record.serverVersion ?? 0) > 0 && !pendingKey) store.delete(record.id);
      else if (pendingKey) store.put({ ...record, serverVersion: 0, serverRevision: undefined });
    }
  }
  for (const entry of pending) outboxStore.put({ ...entry, baseVersion: 0, baseSnapshot: undefined });
  for (const storeName of ["syncBaseSnapshots", "syncConflicts"] as const) {
    const store = tx.objectStore(storeName);
    const items = await result<Array<{ id: string }>>(store.index("ownerUid").getAll(ownerUid));
    items.forEach((item) => store.delete(item.id));
  }
  const stateStore = tx.objectStore("syncState");
  const state = await result<SyncState | undefined>(stateStore.get(ownerUid));
  if (!state) throw new Error("Estado de sincronização inexistente.");
  stateStore.put({ ...state, cursor: 0 });
  await done(tx, "Não foi possível preparar a atualização completa dos dados.");
}

const storeByEntity: Record<SyncEntityType, Exclude<StoreName, "preferences">> = {
  transaction: "transactions",
  category: "categories",
  calculator: "calculator",
  profile: "profiles",
  series: "series",
  seriesSegment: "seriesSegments",
};

function mergeFields(base: Record<string, unknown>, local: Record<string, unknown>, remote: Record<string, unknown>) {
  const value = { ...remote };
  const conflicts: string[] = [];
  for (const field of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const localChanged = !Object.is(base[field], local[field]);
    const remoteChanged = !Object.is(base[field], remote[field]);
    if (localChanged && remoteChanged && !Object.is(local[field], remote[field])) conflicts.push(field);
    else if (localChanged && !remoteChanged) value[field] = local[field];
  }
  return { value, conflicts: conflicts.sort() };
}

export async function applyRemotePage(ownerUid: string, records: RemoteRecord[], state: { cursor: number; epoch: number; serverTime: string }) {
  if (records.some((record) => !storeByEntity[record.entityType])) throw new Error("Resposta de sincronização inválida.");
  const db = await openDatabase();
  const tx = db.transaction([...Object.values(storeByEntity), "syncOutbox", "syncState", "syncBaseSnapshots", "syncConflicts"], "readwrite");
  const outboxStore = tx.objectStore("syncOutbox");
  const pending = await result<OutboxEntry[]>(outboxStore.index("ownerUid").getAll(ownerUid));
  for (const remoteRecord of records) {
    const store = tx.objectStore(storeByEntity[remoteRecord.entityType]);
    const current = await result<SyncPayload | undefined>(store.get(remoteRecord.recordId));
    if (current && current.ownerUid !== ownerUid) {
      tx.abort();
      throw new Error("Resposta de sincronização inválida.");
    }
    const remote = payloadFromServer(remoteRecord.entityType, remoteRecord.recordId, ownerUid, remoteRecord.payload, { ...remoteRecord, serverTime: state.serverTime }, current);
    const related = pending.filter((entry) => entry.entityType === remoteRecord.entityType && entry.recordId === remoteRecord.recordId);
    const snapshot: SyncBaseSnapshot = { id: `${ownerUid}:${remoteRecord.entityType}:${remoteRecord.recordId}`, ownerUid, entityType: remoteRecord.entityType, recordId: remoteRecord.recordId, serverVersion: remoteRecord.version, payload: remote };
    tx.objectStore("syncBaseSnapshots").put(snapshot);
    if (!related.length || !current) {
      store.put(remote);
      continue;
    }
    if (remoteRecord.isDeleted && current.isDeleted !== true) {
      const first = related[0]!;
      tx.objectStore("syncConflicts").put({ id: `${ownerUid}:${first.mutationId}:${remoteRecord.entityType}:${remoteRecord.recordId}`, ownerUid, entityType: remoteRecord.entityType, recordId: remoteRecord.recordId, mutationId: first.mutationId, base: first.baseSnapshot, local: current, remote, conflictingFields: ["exclusão"], remoteDeleted: true, createdAt: state.serverTime } satisfies SyncConflict);
      continue;
    }
    const first = related[0]!;
    const base = first.baseSnapshot ? payloadForServer(remoteRecord.entityType, first.baseSnapshot) : {};
    const merged = mergeFields(base, payloadForServer(remoteRecord.entityType, current), remoteRecord.payload);
    if (merged.conflicts.length) {
      tx.objectStore("syncConflicts").put({ id: `${ownerUid}:${first.mutationId}:${remoteRecord.entityType}:${remoteRecord.recordId}`, ownerUid, entityType: remoteRecord.entityType, recordId: remoteRecord.recordId, mutationId: first.mutationId, base: first.baseSnapshot, local: current, remote, conflictingFields: merged.conflicts, createdAt: state.serverTime } satisfies SyncConflict);
      continue;
    }
    related.forEach((entry) => outboxStore.delete(entry.id));
    const next = payloadFromServer(remoteRecord.entityType, remoteRecord.recordId, ownerUid, merged.value, { ...remoteRecord, isDeleted: current.isDeleted === true, serverTime: state.serverTime }, current);
    store.put(next);
    if (!sameServerPayload(remoteRecord.entityType, next, remote)) {
      const mutationId = crypto.randomUUID();
      const operation = next.isDeleted ? "delete" : "upsert";
      outboxStore.put({ id: outboxId(ownerUid, mutationId, remoteRecord.entityType, remoteRecord.recordId), ownerUid, mutationId, entityType: remoteRecord.entityType, recordId: remoteRecord.recordId, operation, baseVersion: remoteRecord.version, payload: next, baseSnapshot: remote, fingerprint: syncFingerprint(remoteRecord.entityType, operation, next), createdAt: state.serverTime } satisfies OutboxEntry);
    }
  }
  const currentState = await result<SyncState | undefined>(tx.objectStore("syncState").get(ownerUid));
  if (!currentState) throw new Error("Estado de sincronização inexistente.");
  tx.objectStore("syncState").put({ ...currentState, cursor: state.cursor, epoch: state.epoch });
  await done(tx, "Não foi possível aplicar os dados recebidos.");
}

export async function acknowledgePush(ownerUid: string, entries: OutboxEntry[], response: { results: Array<{ mutationId: string; status: string; canonicalRecordId?: string; records?: Array<{ entityType: SyncEntityType; recordId: string; version: number; revision: number; isDeleted: boolean }> }> }) {
  const db = await openDatabase();
  const tx = db.transaction([...Object.values(storeByEntity), "syncOutbox", "syncBaseSnapshots"], "readwrite");
  for (const resultItem of response.results) {
    if (!["applied", "merged", "already_applied", "aliased"].includes(resultItem.status)) continue;
    const mutationEntries = entries.filter((entry) => entry.mutationId === resultItem.mutationId);
    for (const entry of mutationEntries) {
      const current = await result<SyncPayload | undefined>(tx.objectStore(storeByEntity[entry.entityType]).get(entry.recordId));
      if (resultItem.status === "aliased") {
        if (current?.ownerUid === ownerUid) tx.objectStore(storeByEntity[entry.entityType]).delete(entry.recordId);
      } else if (current?.ownerUid === ownerUid) {
        const metadata = resultItem.records?.find((record) => record.entityType === entry.entityType && record.recordId === entry.recordId);
        if (metadata) {
          const updated = { ...current, serverVersion: metadata.version, serverRevision: metadata.revision } as SyncPayload;
          tx.objectStore(storeByEntity[entry.entityType]).put(updated);
          tx.objectStore("syncBaseSnapshots").put({ id: `${ownerUid}:${entry.entityType}:${entry.recordId}`, ownerUid, entityType: entry.entityType, recordId: entry.recordId, serverVersion: metadata.version, payload: updated } satisfies SyncBaseSnapshot);
        }
      }
      tx.objectStore("syncOutbox").delete(entry.id);
    }
  }
  await done(tx, "Não foi possível confirmar as alterações sincronizadas.");
}

export async function resolveSyncConflict(ownerUid: string, conflictId: string, choice: "local" | "remote") {
  const db = await openDatabase();
  const tx = db.transaction([...Object.values(storeByEntity), "syncOutbox", "syncConflicts"], "readwrite");
  const conflict = await result<SyncConflict | undefined>(tx.objectStore("syncConflicts").get(conflictId));
  if (!conflict || conflict.ownerUid !== ownerUid) throw new Error("Conflito inexistente.");
  const chosen = choice === "local" ? conflict.local : conflict.remote;
  tx.objectStore(storeByEntity[conflict.entityType]).put(chosen);
  const pending = await result<OutboxEntry[]>(tx.objectStore("syncOutbox").index("ownerUid").getAll(ownerUid));
  pending.filter((entry) => entry.entityType === conflict.entityType && entry.recordId === conflict.recordId).forEach((entry) => tx.objectStore("syncOutbox").delete(entry.id));
  if (choice === "local") {
    const mutationId = crypto.randomUUID();
    const operation = chosen.isDeleted ? "delete" : "upsert";
    tx.objectStore("syncOutbox").put({ id: outboxId(ownerUid, mutationId, conflict.entityType, conflict.recordId), ownerUid, mutationId, entityType: conflict.entityType, recordId: conflict.recordId, operation, baseVersion: conflict.remote.serverVersion ?? 0, payload: chosen, baseSnapshot: conflict.remote, fingerprint: syncFingerprint(conflict.entityType, operation, chosen), createdAt: new Date().toISOString() } satisfies OutboxEntry);
  }
  tx.objectStore("syncConflicts").delete(conflict.id);
  await done(tx, "Não foi possível resolver o conflito.");
}

export async function calculatorEntriesForSync(ownerUid: string, limit = 100) {
  return (await calculatorRepository.list(ownerUid)).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  ).slice(0, limit);
}

export async function ensureFinancialProfiles(ownerUid: string) {
  const existing = await profilesRepository.list(ownerUid);
  if (existing.length) return existing;
  const timestamp = new Date().toISOString();
  const profile: FinancialProfile = { id: principalId(ownerUid), ownerUid, name: "Principal", createdAt: timestamp, updatedAt: timestamp, isDeleted: false };
  await profilesRepository.put(profile);
  const transactions = await transactionsRepository.list(ownerUid, true);
  const unassigned = transactions.filter((item) => !item.profileId);
  if (unassigned.length) await putTransactionsAtomic(unassigned.map((item) => ({ ...item, profileId: profile.id, updatedAt: timestamp })));
  return [profile];
}

export async function addFinancialProfile(ownerUid: string, name: string) {
  const clean = name.trim();
  if (!clean || clean.length > 40) throw new Error("O perfil deve ter de 1 a 40 caracteres.");
  const profiles = await ensureFinancialProfiles(ownerUid);
  if (profiles.some((item) => nameKey(item.name) === nameKey(clean))) throw new Error("Já existe um perfil com esse nome.");
  const timestamp = new Date().toISOString();
  const profile: FinancialProfile = { id: crypto.randomUUID(), ownerUid, name: clean, createdAt: timestamp, updatedAt: timestamp };
  await profilesRepository.put(profile);
  return profile;
}

export async function renameFinancialProfile(ownerUid: string, profileId: string, name: string) {
  const clean = name.trim();
  if (!clean || clean.length > 40) throw new Error("O perfil deve ter de 1 a 40 caracteres.");
  const profiles = await ensureFinancialProfiles(ownerUid);
  const current = profiles.find((item) => item.id === profileId);
  if (!current) throw new Error("Perfil inexistente ou pertencente a outra conta.");
  if (profiles.some((item) => item.id !== profileId && nameKey(item.name) === nameKey(clean))) throw new Error("Já existe um perfil com esse nome.");
  const updated = { ...current, name: clean, updatedAt: new Date().toISOString() };
  await profilesRepository.put(updated);
  return updated;
}

export async function deleteFinancialProfile(ownerUid: string, sourceId: string, destinationId?: string) {
  const [profiles, transactions, segments] = await Promise.all([
    profilesRepository.list(ownerUid),
    transactionsRepository.list(ownerUid, true),
    seriesSegmentsRepository.list(ownerUid, true),
  ]);
  const source = profiles.find((item) => item.id === sourceId);
  if (!source) throw new Error("Perfil inexistente ou pertencente a outra conta.");
  if (profiles.length <= 1) throw new Error("O único perfil não pode ser excluído.");
  const linked = transactions.filter((item) => item.profileId === sourceId);
  const destination = destinationId ? profiles.find((item) => item.id === destinationId) : undefined;
  if (linked.length && !destination) throw new Error("Selecione um perfil de destino.");
  if (destination?.id === sourceId) throw new Error("O perfil de destino deve ser diferente.");
  const linkedSegments = segments.filter((item) => item.profileId === sourceId);
  if (linkedSegments.length && !destination) throw new Error("Selecione um perfil de destino.");
  const db = await openDatabase();
  const tx = db.transaction(["profiles", "transactions", "seriesSegments", "syncOutbox"], "readwrite");
  const timestamp = new Date().toISOString();
  const mutationId = crypto.randomUUID();
  linked.forEach((item) => {
    const next = syncRecord({ ...item, profileId: destination!.id, updatedAt: timestamp }, item);
    tx.objectStore("transactions").put(next);
    enqueueChange(tx, "transaction", next, item, next.isDeleted ? "delete" : "upsert", mutationId);
  });
  linkedSegments.forEach((item) => {
    const next = syncRecord({ ...item, profileId: destination!.id, updatedAt: timestamp }, item);
    tx.objectStore("seriesSegments").put(next);
    enqueueChange(tx, "seriesSegment", next, item, next.isDeleted ? "delete" : "upsert", mutationId);
  });
  const tombstone = syncRecord({ ...source, isDeleted: true, deletedAt: timestamp, updatedAt: timestamp }, source);
  tx.objectStore("profiles").put(tombstone);
  const transferDestination = destination?.id ?? profiles.find((profile) => profile.id !== sourceId)!.id;
  enqueueChange(tx, "profile", tombstone, source, "delete", mutationId, { command: "delete-profile-and-transfer", destinationProfileId: transferDestination });
  await done(tx, "A exclusão foi cancelada sem alterar os dados.");
  return { transferred: linked.length, destinationId: destination?.id };
}

export async function ensureDefaultCategories(ownerUid: string) {
  const existing = await categoriesRepository.list(ownerUid);
  const missing = DEFAULT_CATEGORIES.filter((expected) => !existing.some((item) => item.type === expected.type && item.name.localeCompare(expected.name, "pt-BR", { sensitivity: "base" }) === 0));
  if (missing.length) await categoriesRepository.putMany(missing.map((category) => ({ ...category, id: `default:${crypto.randomUUID()}`, ownerUid, isDefault: true, canonicalKey: categoryCanonicalKey(category), isDeleted: false })));
}
export async function addCategory(ownerUid: string, name: string, type: Category["type"]) {
  const clean = name.trim();
  if (!clean || clean.length > 40) throw new Error("A categoria deve ter de 1 a 40 caracteres.");
  const existing = await categoriesRepository.list(ownerUid);
  if (existing.some((item) => item.type === type && item.name.localeCompare(clean, "pt-BR", { sensitivity: "base" }) === 0)) throw new Error("Essa categoria já existe.");
  const category: Category = { id: crypto.randomUUID(), ownerUid, name: clean, type, isDefault: false, canonicalKey: categoryCanonicalKey({ name: clean, type }), isDeleted: false };
  await categoriesRepository.put(category);
  return category;
}
export async function deleteCategory(ownerUid: string, categoryId: string) {
  const category = (await categoriesRepository.list(ownerUid)).find((item) => item.id === categoryId);
  if (!category) return;
  if (category.isDefault) throw new Error("Categorias padrão não podem ser excluídas.");
  if ((await transactionsRepository.list(ownerUid)).some((item) => item.categoryId === categoryId && item.isDeleted !== true)) throw new Error("A categoria está em uso. Altere a categoria dos lançamentos ativos antes de excluí-la.");
  if ((await seriesSegmentsRepository.list(ownerUid)).some((item) => item.categoryId === categoryId)) throw new Error("A categoria está em uso por uma série. Altere a categoria da série antes de excluí-la.");
  await categoriesRepository.delete(categoryId, ownerUid);
}

async function getPreference<T>(id: string) {
  const db = await openDatabase();
  return result<{ id: string; value: T } | undefined>(db.transaction("preferences").objectStore("preferences").get(id));
}
async function setPreference(id: string, value: unknown) {
  const db = await openDatabase();
  await result(db.transaction("preferences", "readwrite").objectStore("preferences").put({ id, value }));
}
export async function getTheme(ownerUid: string): Promise<ThemePreference> {
  const current = await getPreference<unknown>(`theme:${ownerUid}`);
  if (current?.value !== "dark") await setPreference(`theme:${ownerUid}`, "dark");
  return "dark";
}
export async function getSelectedProfile(ownerUid: string, profiles: FinancialProfile[]) {
  const value = (await getPreference<unknown>(`selected-profile:${ownerUid}`))?.value;
  return typeof value === "string" && profiles.some((profile) => profile.id === value) ? value : "";
}
export async function setSelectedProfile(ownerUid: string, profileId: string) {
  if (profileId && !(await profilesRepository.list(ownerUid)).some((profile) => profile.id === profileId)) throw new Error("Perfil inexistente ou pertencente a outra conta.");
  await setPreference(`selected-profile:${ownerUid}`, profileId);
}
/** Limpeza física restrita a fixtures locais; fluxos reais usam resetUserData e tombstones. */
export async function clearUserDataForTesting(ownerUid: string) {
  await Promise.all([transactionsRepository.clear(ownerUid), categoriesRepository.clear(ownerUid), calculatorRepository.clear(ownerUid), profilesRepository.clear(ownerUid), seriesRepository.clear(ownerUid), seriesSegmentsRepository.clear(ownerUid)]);
  await setPreference(`selected-profile:${ownerUid}`, "");
  const db = await openDatabase();
  const tx = db.transaction([...SYNC_STORES], "readwrite");
  for (const storeName of ["syncOutbox", "syncBaseSnapshots", "syncConflicts"] as const) {
    const request = tx.objectStore(storeName).index("ownerUid").openCursor(IDBKeyRange.only(ownerUid));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
  }
  tx.objectStore("syncState").delete(ownerUid);
  await done(tx);
}

export async function resetUserData(ownerUid: string) {
  const timestamp = new Date().toISOString();
  const profile: FinancialProfile = {
    id: principalId(ownerUid),
    ownerUid,
    name: "Principal",
    createdAt: timestamp,
    updatedAt: timestamp,
    isDeleted: false,
  };
  const categories: Category[] = DEFAULT_CATEGORIES.map((category) => ({
    ...category,
    id: `default:${crypto.randomUUID()}`,
    ownerUid,
    isDefault: true,
    canonicalKey: categoryCanonicalKey(category),
    isDeleted: false,
  }));
  try {
    await importBackup(ownerUid, {
      schemaVersion: 4,
      app: "Gastos Simples",
      ownerUid,
      exportedAt: timestamp,
      transactions: [],
      categories,
      calculator: [],
      profiles: [profile],
      series: [],
      seriesSegments: [],
      preferences: { theme: "dark", confirmBeforeDelete: true, selectedProfileId: "" },
    }, "replace");
  } catch {
    throw new Error("O reinício foi cancelado sem alterar os dados.");
  }
}

export type Backup = {
  schemaVersion: 4;
  app: "Gastos Simples";
  ownerUid: string;
  exportedAt: string;
  transactions: Transaction[];
  categories: Category[];
  calculator: CalculatorEntry[];
  profiles: FinancialProfile[];
  series: TransactionSeries[];
  seriesSegments: TransactionSeriesSegment[];
  preferences: { theme: ThemePreference; confirmBeforeDelete: boolean; selectedProfileId: string };
};
type BackupV3 = Omit<Backup, "schemaVersion" | "series" | "seriesSegments"> & { schemaVersion: 3 };
type BackupV2 = Omit<BackupV3, "schemaVersion" | "profiles" | "transactions" | "preferences"> & {
  schemaVersion: 2;
  transactions: Array<Omit<Transaction, "profileId"> & { profileId?: string }>;
  preferences: { theme: unknown; confirmBeforeDelete: boolean };
};

function withoutSyncMetadata<T extends SyncPayload>(item: T): T {
  const { localVersion: _localVersion, serverVersion: _serverVersion, serverRevision: _serverRevision, deletedAt: _deletedAt, ...portable } = item;
  return portable as T;
}

function deriveSeries(transactions: Transaction[]) {
  const series: TransactionSeries[] = [];
  const seriesSegments: TransactionSeriesSegment[] = [];
  const groups = new Map<string, Transaction[]>();
  transactions.forEach((item) => {
    if (!item.seriesId || item.kind === "single") return;
    const values = groups.get(item.seriesId) ?? [];
    values.push(item);
    groups.set(item.seriesId, values);
  });
  groups.forEach((items, seriesId) => {
    items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const first = items[0]!;
    const updatedAt = items.map((item) => item.updatedAt).sort().at(-1) ?? first.updatedAt;
    series.push({ id: seriesId, ownerUid: first.ownerUid, kind: first.kind as "recurring" | "installment", startDate: first.dueDate, endBefore: items.map((item) => item.seriesEndDate).filter((value): value is string => Boolean(value)).sort()[0], installmentTotal: first.installmentTotal, createdAt: first.createdAt, updatedAt, isDeleted: false });
    seriesSegments.push({ id: `segment:${seriesId}:${first.dueDate}`, ownerUid: first.ownerUid, seriesId, effectiveFrom: first.dueDate, anchorDueDate: first.dueDate, profileId: first.profileId, description: first.description, amountCents: first.amountCents, type: first.type, categoryId: first.categoryId, categoryName: first.categoryName, notes: first.notes, createdAt: first.createdAt, updatedAt, isDeleted: false });
  });
  return { series, seriesSegments };
}

export async function exportBackup(ownerUid: string): Promise<Backup> {
  const profiles = await ensureFinancialProfiles(ownerUid);
  const [transactions, categories, calculator, series, seriesSegments, theme, selectedProfileId] = await Promise.all([
    transactionsRepository.list(ownerUid), categoriesRepository.list(ownerUid), calculatorRepository.list(ownerUid), seriesRepository.list(ownerUid), seriesSegmentsRepository.list(ownerUid), getTheme(ownerUid), getSelectedProfile(ownerUid, profiles),
  ]);
  return {
    schemaVersion: 4,
    app: "Gastos Simples",
    ownerUid,
    exportedAt: new Date().toISOString(),
    transactions: transactions.filter((item) => !item.isDeleted).map(withoutSyncMetadata),
    categories: categories.map(withoutSyncMetadata),
    calculator: calculator.map(withoutSyncMetadata),
    profiles: profiles.map(withoutSyncMetadata),
    series: series.map(withoutSyncMetadata),
    seriesSegments: seriesSegments.map(withoutSyncMetadata),
    preferences: { theme, confirmBeforeDelete: true, selectedProfileId },
  };
}

const types = new Set<TransactionType>(["expense", "income"]), statuses = new Set<TransactionStatus>(["pending", "paid", "received"]), kinds = new Set<TransactionKind>(["single", "recurring", "installment"]);
const text = (value: unknown, max: number, required = true) => typeof value === "string" && value.length <= max && (!required || value.trim().length > 0);
const timestamp = (value: unknown) => text(value, 40) && /^\d{4}-\d{2}-\d{2}T/.test(value as string) && Number.isFinite(Date.parse(value as string));
const uniqueIds = (items: Array<{ id: string }>) => new Set(items.map(({ id }) => id)).size === items.length;
export function validateBackup(value: unknown, ownerUid: string): Backup {
  if (!value || typeof value !== "object") throw new Error("Arquivo de backup inválido.");
  const data = value as Partial<Backup | BackupV3 | BackupV2>;
  if (![2, 3, 4].includes(Number(data.schemaVersion)) || data.app !== "Gastos Simples" || data.ownerUid !== ownerUid || !timestamp(data.exportedAt) || !Array.isArray(data.transactions) || !Array.isArray(data.categories) || !Array.isArray(data.calculator) || !data.preferences || typeof data.preferences !== "object" || (data.schemaVersion === 4 && (!Array.isArray(data.series) || !Array.isArray(data.seriesSegments)))) throw new Error("Backup inválido ou pertencente a outra conta.");
  const legacy = data.schemaVersion === 2;
  const exportedAt = data.exportedAt as string;
  const profiles: FinancialProfile[] = legacy ? [{ id: principalId(ownerUid), ownerUid, name: "Principal", createdAt: exportedAt, updatedAt: exportedAt, isDeleted: false }] : "profiles" in data && Array.isArray(data.profiles) ? data.profiles : [];
  const transactions = data.transactions.map((item) => {
    const id = String(item.id ?? "");
    const kind = item.kind as TransactionKind;
    const occurrenceKey = kind === "single" ? `single:${id}` : item.occurrenceKey;
    return { ...item, occurrenceKey, profileId: legacy ? principalId(ownerUid) : item.profileId ?? "", isDeleted: false };
  }) as Transaction[];
  if (transactions.length > 50_000 || data.categories.length > 1_000 || data.calculator.length > 10_000 || profiles.length > 500 || !profiles.length) throw new Error("O backup excede os limites permitidos.");
  const derived = deriveSeries(transactions);
  const series = data.schemaVersion === 4 && Array.isArray(data.series) ? data.series : derived.series;
  const seriesSegments = data.schemaVersion === 4 && Array.isArray(data.seriesSegments) ? data.seriesSegments : derived.seriesSegments;
  if (series.length > 10_000 || seriesSegments.length > 50_000) throw new Error("O backup excede os limites permitidos.");
  const categories = data.categories.map((item) => ({ ...item, canonicalKey: categoryCanonicalKey(item), isDeleted: false })) as Category[];
  const calculator = data.calculator.map((item) => ({ ...item, isDeleted: false })) as CalculatorEntry[];
  const collections = [transactions, categories, calculator, profiles, series, seriesSegments] as Array<Array<{ id: string; ownerUid: string }>>;
  const validOwner = collections.flat().every((item) => item && item.ownerUid === ownerUid && text(item.id, 128));
  const validProfiles = profiles.every((item) => text(item.name, 40) && item.name === item.name.trim() && timestamp(item.createdAt) && timestamp(item.updatedAt));
  const profileIds = new Set(profiles.map((item) => item.id));
  const validTransactions = transactions.every((item) => types.has(item.type) && statuses.has(item.status) && kinds.has(item.kind) && ((item.type === "expense" && item.status !== "received") || (item.type === "income" && item.status !== "paid")) && Number.isSafeInteger(item.amountCents) && item.amountCents > 0 && text(item.description, 80) && text(item.notes, 500, false) && text(item.occurrenceKey, 180) && text(item.categoryId, 128) && text(item.categoryName, 40) && text(item.profileId, 128) && profileIds.has(item.profileId) && isValidCivilDate(item.dueDate) && timestamp(item.createdAt) && timestamp(item.updatedAt) && (!item.paidAt || timestamp(item.paidAt)) && (!item.seriesId || text(item.seriesId, 128)) && (!item.seriesEndDate || (item.kind === "recurring" && isValidCivilDate(item.seriesEndDate))) && (item.isDeleted === undefined || typeof item.isDeleted === "boolean") && ((item.kind === "single" && !item.seriesId && item.occurrenceKey === `single:${item.id}` && item.installmentCurrent === undefined && item.installmentTotal === undefined) || (item.kind === "recurring" && Boolean(item.seriesId) && item.occurrenceKey === `${item.seriesId}:${item.dueDate.slice(0, 7)}` && item.installmentCurrent === undefined && item.installmentTotal === undefined) || (item.kind === "installment" && Boolean(item.seriesId) && item.occurrenceKey === `${item.seriesId}:${item.installmentCurrent}` && Number.isInteger(item.installmentCurrent) && Number.isInteger(item.installmentTotal) && item.installmentCurrent! >= 1 && item.installmentTotal! >= 2 && item.installmentCurrent! <= item.installmentTotal!)));
  const validCategories = categories.every((item) => types.has(item.type) && text(item.name, 40) && typeof item.isDefault === "boolean");
  const validCalculator = calculator.every((item) => text(item.expression, 200) && text(item.result, 100) && timestamp(item.createdAt));
  const categoryKeys = categories.map((item) => `${item.type}:${nameKey(item.name)}`);
  const profileKeys = profiles.map((item) => nameKey(item.name));
  const categoryById = new Map(categories.map((item) => [item.id, item]));
  const validReferences = transactions.every((item) => { const category = categoryById.get(item.categoryId); return category?.type === item.type && category.name === item.categoryName; });
  const preferences = data.preferences as { theme?: unknown; confirmBeforeDelete?: unknown; selectedProfileId?: unknown };
  const selectedProfileId = legacy ? "" : preferences.selectedProfileId;
  const validPreferences = ["light", "dark", "system"].includes(String(preferences.theme)) && typeof preferences.confirmBeforeDelete === "boolean" && typeof selectedProfileId === "string" && (!selectedProfileId || profileIds.has(selectedProfileId));
  const seriesIds = new Set(series.map((item) => item.id));
  const seriesById = new Map(series.map((item) => [item.id, item]));
  const validSeries = series.every((item) => ["recurring", "installment"].includes(item.kind) && isValidCivilDate(item.startDate) && timestamp(item.createdAt) && timestamp(item.updatedAt) && (!item.endBefore || isValidCivilDate(item.endBefore)) && (item.kind !== "installment" || (Number.isInteger(item.installmentTotal) && item.installmentTotal! >= 2 && item.installmentTotal! <= 999)));
  const validSeriesReferences = transactions.every((item) => item.kind === "single" || seriesById.get(item.seriesId!)?.kind === item.kind) && series.every((item) => seriesSegments.some((segment) => segment.seriesId === item.id));
  const validSegments = seriesSegments.every((item) => seriesIds.has(item.seriesId) && isValidCivilDate(item.effectiveFrom) && isValidCivilDate(item.anchorDueDate) && profileIds.has(item.profileId) && categoryById.get(item.categoryId)?.type === item.type && categoryById.get(item.categoryId)?.name === item.categoryName && text(item.description, 80) && text(item.notes, 500, false) && Number.isSafeInteger(item.amountCents) && item.amountCents > 0 && timestamp(item.createdAt) && timestamp(item.updatedAt));
  if (!validOwner || !collections.every(uniqueIds) || !validProfiles || new Set(profileKeys).size !== profileKeys.length || !validTransactions || !validCategories || !validCalculator || !validSeries || !validSeriesReferences || !validSegments || new Set(seriesSegments.map((item) => `${item.seriesId}:${item.effectiveFrom}`)).size !== seriesSegments.length || new Set(categoryKeys).size !== categoryKeys.length || !validReferences || new Set(transactions.map((item) => `${item.ownerUid}:${item.occurrenceKey}`)).size !== transactions.length || !validPreferences) throw new Error("O backup contém dados inválidos.");
  return { schemaVersion: 4, app: "Gastos Simples", ownerUid, exportedAt, transactions, categories, calculator, profiles: profiles.map((item) => ({ ...item, isDeleted: false })), series, seriesSegments, preferences: { theme: "dark", confirmBeforeDelete: true, selectedProfileId: selectedProfileId as string } };
}

export async function importBackup(ownerUid: string, rawBackup: Backup | BackupV3 | BackupV2, mode: "replace" | "merge") {
  const backup = validateBackup(rawBackup, ownerUid);
  const current = await Promise.all([transactionsRepository.list(ownerUid), categoriesRepository.list(ownerUid), calculatorRepository.list(ownerUid), profilesRepository.list(ownerUid), seriesRepository.list(ownerUid), seriesSegmentsRepository.list(ownerUid)]);
  let [transactions, categories, calculator, profiles, series, seriesSegments] = [backup.transactions, backup.categories, backup.calculator, backup.profiles, backup.series, backup.seriesSegments];
  let selectedProfileId = backup.preferences.selectedProfileId;
  if (mode === "merge") {
    const [oldTransactions, oldCategories, oldCalculator, oldProfiles, oldSeries, oldSegments] = current;
    const profileMap = new Map<string, string>();
    profiles = [...oldProfiles];
    backup.profiles.forEach((profile) => {
      const same = profiles.find((item) => nameKey(item.name) === nameKey(profile.name));
      if (same) profileMap.set(profile.id, same.id);
      else { const id = profiles.some((item) => item.id === profile.id) ? crypto.randomUUID() : profile.id; profileMap.set(profile.id, id); profiles.push({ ...profile, id }); }
    });
    const categoryMap = new Map<string, string>();
    categories = [...oldCategories];
    backup.categories.forEach((category) => {
      const same = categories.find((item) => item.type === category.type && item.name.localeCompare(category.name, "pt-BR", { sensitivity: "base" }) === 0);
      if (same) categoryMap.set(category.id, same.id);
      else { const id = categories.some((item) => item.id === category.id) ? crypto.randomUUID() : category.id; categoryMap.set(category.id, id); categories.push({ ...category, id }); }
    });
    const byId = new Map(oldTransactions.map((item) => [item.id, item])), occurrences = new Set(oldTransactions.map((item) => item.occurrenceKey));
    transactions = [...oldTransactions];
    backup.transactions.forEach((item) => {
      if (occurrences.has(item.occurrenceKey) && !byId.has(item.id)) return;
      const id = byId.has(item.id) ? item.id : item.id;
      const categoryId = categoryMap.get(item.categoryId)!;
      const category = categories.find((value) => value.id === categoryId)!;
      const next = { ...item, id, occurrenceKey: item.kind === "single" ? `single:${id}` : item.occurrenceKey, profileId: profileMap.get(item.profileId)!, categoryId, categoryName: category.name };
      const index = transactions.findIndex((value) => value.id === id);
      if (index >= 0) transactions[index] = next;
      else transactions.push(next);
      occurrences.add(next.occurrenceKey);
    });
    const calculatorKeys = new Set(oldCalculator.map((item) => `${item.expression}\u0000${item.result}\u0000${item.createdAt}`));
    calculator = [...oldCalculator, ...backup.calculator.filter((item) => !calculatorKeys.has(`${item.expression}\u0000${item.result}\u0000${item.createdAt}`))];
    series = [...oldSeries, ...backup.series.filter((item) => !oldSeries.some((old) => old.id === item.id))];
    seriesSegments = [...oldSegments, ...backup.seriesSegments
      .filter((item) => !oldSegments.some((old) => old.id === item.id))
      .map((item) => {
        const categoryId = categoryMap.get(item.categoryId)!;
        const category = categories.find((value) => value.id === categoryId)!;
        return { ...item, profileId: profileMap.get(item.profileId)!, categoryId, categoryName: category.name };
      })];
    selectedProfileId = selectedProfileId ? profileMap.get(selectedProfileId) ?? "" : "";
  }
  const db = await openDatabase();
  const tx = db.transaction(["transactions", "categories", "calculator", "profiles", "series", "seriesSegments", "preferences", "syncOutbox"], "readwrite");
  const mutationId = crypto.randomUUID();
  const deletedAt = new Date().toISOString();
  const apply = async <T extends SyncPayload>(storeName: Exclude<StoreName, "preferences">, entityType: SyncEntityType, desired: T[]) => {
    const store = tx.objectStore(storeName);
    const existing = await result<T[]>(store.index("ownerUid").getAll(ownerUid));
    const desiredIds = new Set(desired.map((item) => item.id));
    if (mode === "replace") for (const previous of existing) {
      if (previous.isDeleted === true || desiredIds.has(previous.id)) continue;
      const tombstone = syncRecord({ ...previous, isDeleted: true, deletedAt } as T, previous);
      store.put(tombstone);
      enqueueChange(tx, entityType, tombstone, previous, "delete", mutationId);
    }
    for (const item of desired) {
      const previous = await result<T | undefined>(store.get(item.id));
      if (previous && previous.ownerUid !== ownerUid) throw new Error("Identificador pertencente a outra conta.");
      const next = syncRecord({ ...item, ownerUid, isDeleted: false, deletedAt: undefined } as T, previous);
      const comparablePrevious = previous ? JSON.stringify(withoutSyncMetadata(previous)) : "";
      const comparableNext = JSON.stringify(withoutSyncMetadata(next));
      if (previous && comparablePrevious === comparableNext) continue;
      store.put(next);
      enqueueChange(tx, entityType, next, previous, "upsert", mutationId);
    }
  };
  try {
    await apply("profiles", "profile", profiles);
    await apply("categories", "category", categories);
    await apply("series", "series", series);
    await apply("seriesSegments", "seriesSegment", seriesSegments);
    await apply("transactions", "transaction", transactions);
    await apply("calculator", "calculator", calculator);
    tx.objectStore("preferences").put({ id: `theme:${ownerUid}`, value: "dark" });
    tx.objectStore("preferences").put({ id: `confirm-delete:${ownerUid}`, value: true });
    tx.objectStore("preferences").put({ id: `selected-profile:${ownerUid}`, value: selectedProfileId });
    await done(tx, "A importação foi cancelada sem alterar os dados.");
  } catch {
    try { tx.abort(); } catch { /* A transação já foi encerrada. */ }
    throw new Error("A importação foi cancelada sem alterar os dados.");
  }
}
