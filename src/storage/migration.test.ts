import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

const requestValue = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

describe("migração IndexedDB v1 para v2", () => {
  it("cria Principal por proprietário e associa ativos e excluídos atomicamente", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const open = indexedDB.open("gastos-simples", 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      const transactions = db.createObjectStore("transactions", { keyPath: "id" });
      transactions.createIndex("ownerUid", "ownerUid");
      transactions.createIndex("ownerMonth", ["ownerUid", "dueDate"]);
      const categories = db.createObjectStore("categories", { keyPath: "id" });
      categories.createIndex("ownerUid", "ownerUid");
      const calculator = db.createObjectStore("calculator", { keyPath: "id" });
      calculator.createIndex("ownerUid", "ownerUid");
      db.createObjectStore("preferences", { keyPath: "id" });
    };
    const oldDb = await requestValue(open);
    const tx = oldDb.transaction(["transactions", "categories"], "readwrite");
    const base = { occurrenceKey: "single:1", description: "Legado", amountCents: 100, type: "expense", status: "pending", dueDate: "2028-01-01", categoryId: "c", categoryName: "Casa", notes: "", kind: "single", createdAt: "2028-01-01T00:00:00Z", updatedAt: "2028-01-01T00:00:00Z" };
    tx.objectStore("transactions").put({ ...base, id: "active", ownerUid: "u1" });
    tx.objectStore("transactions").put({ ...base, id: "deleted", ownerUid: "u1", occurrenceKey: "single:2", isDeleted: true });
    tx.objectStore("transactions").put({ ...base, id: "other", ownerUid: "u2", occurrenceKey: "single:3" });
    tx.objectStore("categories").put({ id: "c", ownerUid: "u1", name: "Casa", type: "expense", isDefault: false });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    oldDb.close();

    vi.resetModules();
    const { profilesRepository, transactionsRepository } = await import("./database");
    expect((await profilesRepository.list("u1")).map((profile) => profile.name)).toEqual(["Principal"]);
    expect(await profilesRepository.list("u2")).toHaveLength(1);
    const migrated = await transactionsRepository.list("u1");
    expect(migrated).toHaveLength(2);
    expect(migrated.every((item) => item.profileId === "profile:principal:u1")).toBe(true);
    expect(migrated.some((item) => item.isDeleted)).toBe(true);
    vi.unstubAllGlobals();
  });
});
