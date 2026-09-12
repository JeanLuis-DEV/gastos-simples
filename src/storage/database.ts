import { isValidCivilDate } from "../domain/dates";
import type { CalculatorEntry, Category, FinancialProfile, ThemePreference, Transaction, TransactionKind, TransactionStatus, TransactionType } from "../domain/models";
import { DEFAULT_CATEGORIES } from "../domain/models";

const DB_NAME = "gastos-simples";
const DB_VERSION = 2;
type StoreName = "transactions" | "categories" | "calculator" | "preferences" | "profiles";
const principalId = (uid: string) => `profile:principal:${uid}`;
const nameKey = (name: string) => name.trim().toLocaleLowerCase("pt-BR");

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

export class LocalRepository<T extends { id: string; ownerUid: string }> {
  constructor(private readonly storeName: StoreName) {}
  async list(ownerUid: string): Promise<T[]> {
    const db = await openDatabase();
    return result(db.transaction(this.storeName).objectStore(this.storeName).index("ownerUid").getAll(ownerUid));
  }
  async put(item: T): Promise<void> {
    const db = await openDatabase();
    await result(db.transaction(this.storeName, "readwrite").objectStore(this.storeName).put(item));
  }
  async putMany(items: T[]): Promise<void> {
    if (!items.length) return;
    const db = await openDatabase();
    const tx = db.transaction(this.storeName, "readwrite");
    items.forEach((item) => tx.objectStore(this.storeName).put(item));
    await done(tx);
  }
  async delete(id: string, ownerUid: string): Promise<T | undefined> {
    const db = await openDatabase();
    const tx = db.transaction(this.storeName, "readwrite");
    const store = tx.objectStore(this.storeName);
    const item = await result<T | undefined>(store.get(id));
    if (!item || item.ownerUid !== ownerUid) return undefined;
    store.delete(id);
    await done(tx);
    return item;
  }
  async clear(ownerUid: string): Promise<void> {
    const items = await this.list(ownerUid);
    if (!items.length) return;
    const db = await openDatabase();
    const tx = db.transaction(this.storeName, "readwrite");
    items.forEach(({ id }) => tx.objectStore(this.storeName).delete(id));
    await done(tx);
  }
}

export const transactionsRepository = new LocalRepository<Transaction>("transactions");
export const categoriesRepository = new LocalRepository<Category>("categories");
export const calculatorRepository = new LocalRepository<CalculatorEntry>("calculator");
export const profilesRepository = new LocalRepository<FinancialProfile>("profiles");

export async function ensureFinancialProfiles(ownerUid: string) {
  const existing = await profilesRepository.list(ownerUid);
  if (existing.length) return existing;
  const timestamp = new Date().toISOString();
  const profile: FinancialProfile = { id: principalId(ownerUid), ownerUid, name: "Principal", createdAt: timestamp, updatedAt: timestamp };
  const db = await openDatabase();
  const tx = db.transaction(["profiles", "transactions"], "readwrite");
  tx.objectStore("profiles").put(profile);
  const transactions = await result<Transaction[]>(tx.objectStore("transactions").index("ownerUid").getAll(ownerUid));
  transactions.filter((item) => !item.profileId).forEach((item) => tx.objectStore("transactions").put({ ...item, profileId: profile.id }));
  await done(tx);
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
  const [profiles, transactions] = await Promise.all([profilesRepository.list(ownerUid), transactionsRepository.list(ownerUid)]);
  const source = profiles.find((item) => item.id === sourceId);
  if (!source) throw new Error("Perfil inexistente ou pertencente a outra conta.");
  if (profiles.length <= 1) throw new Error("O único perfil não pode ser excluído.");
  const linked = transactions.filter((item) => item.profileId === sourceId);
  const destination = destinationId ? profiles.find((item) => item.id === destinationId) : undefined;
  if (linked.length && !destination) throw new Error("Selecione um perfil de destino.");
  if (destination?.id === sourceId) throw new Error("O perfil de destino deve ser diferente.");
  const db = await openDatabase();
  const tx = db.transaction(["profiles", "transactions"], "readwrite");
  const timestamp = new Date().toISOString();
  linked.forEach((item) => tx.objectStore("transactions").put({ ...item, profileId: destination!.id, updatedAt: timestamp }));
  tx.objectStore("profiles").delete(sourceId);
  await done(tx, "A exclusão foi cancelada sem alterar os dados.");
  return { transferred: linked.length, destinationId: destination?.id };
}

export async function ensureDefaultCategories(ownerUid: string) {
  const existing = await categoriesRepository.list(ownerUid);
  const missing = DEFAULT_CATEGORIES.filter((expected) => !existing.some((item) => item.type === expected.type && item.name.localeCompare(expected.name, "pt-BR", { sensitivity: "base" }) === 0));
  if (missing.length) await categoriesRepository.putMany(missing.map((category) => ({ ...category, id: `default:${crypto.randomUUID()}`, ownerUid, isDefault: true })));
}
export async function addCategory(ownerUid: string, name: string, type: Category["type"]) {
  const clean = name.trim();
  if (!clean || clean.length > 40) throw new Error("A categoria deve ter de 1 a 40 caracteres.");
  const existing = await categoriesRepository.list(ownerUid);
  if (existing.some((item) => item.type === type && item.name.localeCompare(clean, "pt-BR", { sensitivity: "base" }) === 0)) throw new Error("Essa categoria já existe.");
  const category: Category = { id: crypto.randomUUID(), ownerUid, name: clean, type, isDefault: false };
  await categoriesRepository.put(category);
  return category;
}
export async function deleteCategory(ownerUid: string, categoryId: string) {
  const category = (await categoriesRepository.list(ownerUid)).find((item) => item.id === categoryId);
  if (!category) return;
  if (category.isDefault) throw new Error("Categorias padrão não podem ser excluídas.");
  if ((await transactionsRepository.list(ownerUid)).some((item) => item.categoryId === categoryId && item.isDeleted !== true)) throw new Error("A categoria está em uso. Altere a categoria dos lançamentos ativos antes de excluí-la.");
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
export async function clearUserData(ownerUid: string) {
  await Promise.all([transactionsRepository.clear(ownerUid), categoriesRepository.clear(ownerUid), calculatorRepository.clear(ownerUid), profilesRepository.clear(ownerUid)]);
  await setPreference(`selected-profile:${ownerUid}`, "");
}

export async function resetUserData(ownerUid: string) {
  const timestamp = new Date().toISOString();
  const profile: FinancialProfile = {
    id: principalId(ownerUid),
    ownerUid,
    name: "Principal",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const categories: Category[] = DEFAULT_CATEGORIES.map((category) => ({
    ...category,
    id: `default:${crypto.randomUUID()}`,
    ownerUid,
    isDefault: true,
  }));
  const db = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      ["transactions", "categories", "calculator", "profiles", "preferences"],
      "readwrite",
    );
    const ownedStores = ["transactions", "categories", "calculator", "profiles"] as const;
    let clearedStores = 0;
    let completed = false;

    const abort = () => {
      try {
        tx.abort();
      } catch {
        // A transação já encerrou e seu evento final tratará o resultado.
      }
    };
    const recreateDefaults = () => {
      try {
        const preferences = tx.objectStore("preferences");
        preferences.delete(`theme:${ownerUid}`);
        preferences.put({ id: `theme:${ownerUid}`, value: "dark" });
        preferences.put({ id: `confirm-delete:${ownerUid}`, value: true });
        preferences.put({ id: `selected-profile:${ownerUid}`, value: "" });
        tx.objectStore("profiles").put(profile);
        const categoryStore = tx.objectStore("categories");
        categories.forEach((category) => categoryStore.put(category));
      } catch {
        abort();
      }
    };

    ownedStores.forEach((storeName) => {
      const request = tx
        .objectStore(storeName)
        .index("ownerUid")
        .openCursor(IDBKeyRange.only(ownerUid));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
          return;
        }
        clearedStores += 1;
        if (clearedStores === ownedStores.length) recreateDefaults();
      };
    });
    tx.oncomplete = () => {
      completed = true;
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      if (!completed) reject(new Error("O reinício foi cancelado sem alterar os dados."));
    };
  });
}

export type Backup = {
  schemaVersion: 3;
  app: "Gastos Simples";
  ownerUid: string;
  exportedAt: string;
  transactions: Transaction[];
  categories: Category[];
  calculator: CalculatorEntry[];
  profiles: FinancialProfile[];
  preferences: { theme: ThemePreference; confirmBeforeDelete: boolean; selectedProfileId: string };
};
export async function exportBackup(ownerUid: string): Promise<Backup> {
  const profiles = await ensureFinancialProfiles(ownerUid);
  const [transactions, categories, calculator, theme, selectedProfileId] = await Promise.all([
    transactionsRepository.list(ownerUid), categoriesRepository.list(ownerUid), calculatorRepository.list(ownerUid), getTheme(ownerUid), getSelectedProfile(ownerUid, profiles),
  ]);
  return { schemaVersion: 3, app: "Gastos Simples", ownerUid, exportedAt: new Date().toISOString(), transactions, categories, calculator, profiles, preferences: { theme, confirmBeforeDelete: true, selectedProfileId } };
}

const types = new Set<TransactionType>(["expense", "income"]), statuses = new Set<TransactionStatus>(["pending", "paid", "received"]), kinds = new Set<TransactionKind>(["single", "recurring", "installment"]);
const text = (value: unknown, max: number, required = true) => typeof value === "string" && value.length <= max && (!required || value.trim().length > 0);
const timestamp = (value: unknown) => text(value, 40) && /^\d{4}-\d{2}-\d{2}T/.test(value as string) && Number.isFinite(Date.parse(value as string));
const uniqueIds = (items: Array<{ id: string }>) => new Set(items.map(({ id }) => id)).size === items.length;
type LegacyBackup = Omit<Backup, "schemaVersion" | "profiles" | "transactions" | "preferences"> & { schemaVersion: 2; transactions: Array<Omit<Transaction, "profileId"> & { profileId?: string }>; preferences: { theme: unknown; confirmBeforeDelete: boolean } };

export function validateBackup(value: unknown, ownerUid: string): Backup {
  if (!value || typeof value !== "object") throw new Error("Arquivo de backup inválido.");
  const data = value as Partial<Backup | LegacyBackup>;
  if ((data.schemaVersion !== 2 && data.schemaVersion !== 3) || data.app !== "Gastos Simples" || data.ownerUid !== ownerUid || !timestamp(data.exportedAt) || !Array.isArray(data.transactions) || !Array.isArray(data.categories) || !Array.isArray(data.calculator) || !data.preferences || typeof data.preferences !== "object") throw new Error("Backup inválido ou pertencente a outra conta.");
  const legacy = data.schemaVersion === 2;
  const exportedAt = data.exportedAt as string;
  const profiles: FinancialProfile[] = legacy ? [{ id: principalId(ownerUid), ownerUid, name: "Principal", createdAt: exportedAt, updatedAt: exportedAt }] : Array.isArray((data as Partial<Backup>).profiles) ? (data as Backup).profiles : [];
  const transactions = data.transactions.map((item) => ({ ...item, profileId: legacy ? principalId(ownerUid) : item.profileId ?? "" })) as Transaction[];
  if (transactions.length > 50_000 || data.categories.length > 1_000 || data.calculator.length > 10_000 || profiles.length > 500 || !profiles.length) throw new Error("O backup excede os limites permitidos.");
  const collections = [transactions, data.categories, data.calculator, profiles] as Array<Array<{ id: string; ownerUid: string }>>;
  const validOwner = collections.flat().every((item) => item && item.ownerUid === ownerUid && text(item.id, 128));
  const validProfiles = profiles.every((item) => text(item.name, 40) && item.name === item.name.trim() && timestamp(item.createdAt) && timestamp(item.updatedAt));
  const profileIds = new Set(profiles.map((item) => item.id));
  const validTransactions = transactions.every((item) => types.has(item.type) && statuses.has(item.status) && kinds.has(item.kind) && ((item.type === "expense" && item.status !== "received") || (item.type === "income" && item.status !== "paid")) && Number.isSafeInteger(item.amountCents) && item.amountCents > 0 && text(item.description, 80) && text(item.notes, 500, false) && text(item.occurrenceKey, 180) && text(item.categoryId, 128) && text(item.categoryName, 40) && text(item.profileId, 128) && profileIds.has(item.profileId) && isValidCivilDate(item.dueDate) && timestamp(item.createdAt) && timestamp(item.updatedAt) && (!item.paidAt || timestamp(item.paidAt)) && (!item.seriesId || text(item.seriesId, 128)) && (!item.seriesEndDate || (item.kind === "recurring" && isValidCivilDate(item.seriesEndDate))) && (item.isDeleted === undefined || typeof item.isDeleted === "boolean") && ((item.kind === "single" && !item.seriesId && item.installmentCurrent === undefined && item.installmentTotal === undefined) || (item.kind === "recurring" && Boolean(item.seriesId) && item.installmentCurrent === undefined && item.installmentTotal === undefined) || (item.kind === "installment" && Boolean(item.seriesId) && Number.isInteger(item.installmentCurrent) && Number.isInteger(item.installmentTotal) && item.installmentCurrent! >= 1 && item.installmentTotal! >= 2 && item.installmentCurrent! <= item.installmentTotal!)));
  const validCategories = data.categories.every((item) => types.has(item.type) && text(item.name, 40) && typeof item.isDefault === "boolean");
  const validCalculator = data.calculator.every((item) => text(item.expression, 200) && text(item.result, 100) && timestamp(item.createdAt));
  const categoryKeys = data.categories.map((item) => `${item.type}:${nameKey(item.name)}`);
  const profileKeys = profiles.map((item) => nameKey(item.name));
  const categoryById = new Map(data.categories.map((item) => [item.id, item]));
  const validReferences = transactions.every((item) => { const category = categoryById.get(item.categoryId); return category?.type === item.type && category.name === item.categoryName; });
  const preferences = data.preferences as { theme?: unknown; confirmBeforeDelete?: unknown; selectedProfileId?: unknown };
  const selectedProfileId = legacy ? "" : preferences.selectedProfileId;
  const validPreferences = ["light", "dark", "system"].includes(String(preferences.theme)) && typeof preferences.confirmBeforeDelete === "boolean" && typeof selectedProfileId === "string" && (!selectedProfileId || profileIds.has(selectedProfileId));
  if (!validOwner || !collections.every(uniqueIds) || !validProfiles || new Set(profileKeys).size !== profileKeys.length || !validTransactions || !validCategories || !validCalculator || new Set(categoryKeys).size !== categoryKeys.length || !validReferences || new Set(transactions.map((item) => `${item.ownerUid}:${item.occurrenceKey}`)).size !== transactions.length || !validPreferences) throw new Error("O backup contém dados inválidos.");
  return { schemaVersion: 3, app: "Gastos Simples", ownerUid, exportedAt, transactions, categories: data.categories, calculator: data.calculator, profiles, preferences: { theme: "dark", confirmBeforeDelete: true, selectedProfileId: selectedProfileId as string } };
}

export async function importBackup(ownerUid: string, rawBackup: Backup, mode: "replace" | "merge") {
  const backup = validateBackup(rawBackup, ownerUid);
  const current = mode === "merge" ? await Promise.all([transactionsRepository.list(ownerUid), categoriesRepository.list(ownerUid), calculatorRepository.list(ownerUid), profilesRepository.list(ownerUid)]) : [[], [], [], []] as [Transaction[], Category[], CalculatorEntry[], FinancialProfile[]];
  let [transactions, categories, calculator, profiles] = [backup.transactions, backup.categories, backup.calculator, backup.profiles];
  let selectedProfileId = backup.preferences.selectedProfileId;
  if (mode === "merge") {
    const [oldTransactions, oldCategories, oldCalculator, oldProfiles] = current as [Transaction[], Category[], CalculatorEntry[], FinancialProfile[]];
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
    const ids = new Set(oldTransactions.map((item) => item.id)), occurrences = new Set(oldTransactions.map((item) => item.occurrenceKey));
    transactions = [...oldTransactions, ...backup.transactions.map((item) => {
      const id = ids.has(item.id) ? crypto.randomUUID() : item.id;
      const occurrenceKey = occurrences.has(item.occurrenceKey) ? `${item.occurrenceKey}:import:${crypto.randomUUID()}` : item.occurrenceKey;
      ids.add(id); occurrences.add(occurrenceKey);
      const categoryId = categoryMap.get(item.categoryId)!;
      const category = categories.find((value) => value.id === categoryId)!;
      return { ...item, id, occurrenceKey, profileId: profileMap.get(item.profileId)!, categoryId, categoryName: category.name };
    })];
    const calculatorIds = new Set(oldCalculator.map((item) => item.id));
    calculator = [...oldCalculator, ...backup.calculator.map((item) => ({ ...item, id: calculatorIds.has(item.id) ? crypto.randomUUID() : item.id }))];
    selectedProfileId = selectedProfileId ? profileMap.get(selectedProfileId) ?? "" : "";
  }
  const db = await openDatabase();
  const tx = db.transaction(["transactions", "categories", "calculator", "profiles", "preferences"], "readwrite");
  const stores = ["transactions", "categories", "calculator", "profiles"] as const;
  if (mode === "replace") {
    const existing = await Promise.all(stores.map((store) => result<Array<{ id: string }>>(tx.objectStore(store).index("ownerUid").getAll(ownerUid))));
    stores.forEach((store, index) => existing[index]!.forEach((item) => tx.objectStore(store).delete(item.id)));
  }
  const values = { transactions, categories, calculator, profiles };
  stores.forEach((store) => values[store].forEach((item) => tx.objectStore(store).put(item)));
  tx.objectStore("preferences").put({ id: `theme:${ownerUid}`, value: "dark" });
  tx.objectStore("preferences").put({ id: `confirm-delete:${ownerUid}`, value: true });
  tx.objectStore("preferences").put({ id: `selected-profile:${ownerUid}`, value: selectedProfileId });
  await done(tx, "A importação foi cancelada sem alterar os dados.");
}
