import { describe, expect, it } from "vitest";
import type { Transaction } from "../domain/models";
import { payloadForServer, payloadFromServer } from "./serialization";

const transaction: Transaction = {
  id: "transaction-1", ownerUid: "uid-private", profileId: "profile-1", occurrenceKey: "single:transaction-1",
  description: "Mercado", amountCents: 1234, type: "expense", status: "pending", dueDate: "2028-01-01",
  categoryId: "category-1", categoryName: "Casa", notes: "", kind: "single", createdAt: "2028-01-01T00:00:00.000Z",
  updatedAt: "2028-01-01T00:00:00.000Z", localVersion: 4, serverVersion: 2,
};

describe("serialização da sincronização", () => {
  it("nunca envia ownership, UID, versões ou timestamps técnicos", () => {
    const payload = payloadForServer("transaction", transaction);
    expect(payload).toMatchObject({ description: "Mercado", amountCents: 1234 });
    expect(payload).not.toHaveProperty("ownerUid");
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("serverVersion");
    expect(payload).not.toHaveProperty("updatedAt");
  });

  it("atribui ownership e versões somente a partir do contexto autenticado e do servidor", () => {
    expect(payloadFromServer("transaction", "transaction-1", "authenticated-uid", payloadForServer("transaction", transaction), { version: 8, revision: 20, isDeleted: false, serverTime: "2028-02-01T00:00:00.000Z" }))
      .toMatchObject({ id: "transaction-1", ownerUid: "authenticated-uid", serverVersion: 8, serverRevision: 20, updatedAt: "2028-02-01T00:00:00.000Z" });
  });
});
