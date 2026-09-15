import { describe, expect, it } from "vitest";
import type { Transaction } from "../domain/models";
import { threeWayMerge } from "./merge";

const transaction = (changes: Partial<Transaction> = {}): Transaction => ({
  id: "transaction-1",
  ownerUid: "owner-1",
  profileId: "profile-1",
  occurrenceKey: "single:transaction-1",
  description: "Conta",
  amountCents: 1000,
  type: "expense",
  status: "pending",
  dueDate: "2028-01-01",
  categoryId: "category-1",
  categoryName: "Casa",
  notes: "",
  kind: "single",
  createdAt: "2099-01-01T00:00:00.000Z",
  updatedAt: "1900-01-01T00:00:00.000Z",
  serverVersion: 1,
  ...changes,
});

describe("merge determinístico local", () => {
  it("mescla campos diferentes sem usar o relógio do dispositivo", () => {
    const base = transaction();
    const result = threeWayMerge(
      base,
      transaction({ description: "Conta local", updatedAt: "1800-01-01T00:00:00.000Z" }),
      transaction({ notes: "Alteração remota", updatedAt: "2200-01-01T00:00:00.000Z", serverVersion: 2 }),
    );
    expect(result.status).toBe("merged");
    expect(result.value).toMatchObject({ description: "Conta local", notes: "Alteração remota", serverVersion: 2 });
  });

  it("preserva conflito quando o mesmo campo diverge", () => {
    const base = transaction();
    const result = threeWayMerge(base, transaction({ amountCents: 2000 }), transaction({ amountCents: 3000, serverVersion: 2 }));
    expect(result).toMatchObject({ status: "conflict", conflictingFields: ["amountCents"], value: { amountCents: 3000 } });
  });

  it("tombstone remoto vence atualização obsoleta", () => {
    const base = transaction();
    const remote = transaction({ isDeleted: true, deletedAt: "2028-01-02T00:00:00.000Z", serverVersion: 2 });
    expect(threeWayMerge(base, transaction({ description: "Edição atrasada" }), remote)).toEqual({ status: "merged", value: remote });
  });
});
