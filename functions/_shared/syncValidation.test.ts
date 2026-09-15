import { describe, expect, it } from "vitest";
import { MAX_PUSH_BYTES, parsePullRequest, parsePushRequest, validateEntityPayload } from "./syncValidation";

const request = (body: unknown, headers: Record<string, string> = {}) => new Request("https://app.test/api/sync/push", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const valid = (changes: Record<string, unknown> = {}) => ({
  protocolVersion: 1,
  syncEpoch: 1,
  batchId: "batch-1",
  deviceId: "device-1",
  operations: [{ command: "upsert-record", mutationId: "mutation-1", entityType: "profile", recordId: "profile-1", baseVersion: 0, payload: { name: "Principal" } }],
  ...changes,
});

describe("DTOs estritos da sincronização", () => {
  it("aceita somente o contrato conhecido", () => expect(parsePushRequest(request(valid()), valid())).toMatchObject({ protocolVersion: 1 }));

  it.each([
    ["ownerUid", () => valid({ ownerUid: "uid-admin" })],
    ["entitlement", () => valid({ entitlement: "admin" })],
    ["mass assignment", () => valid({ operations: [{ ...valid().operations[0], payload: { name: "Principal", serverVersion: 99 } }] })],
    ["mutation repetida", () => valid({ operations: [valid().operations[0], valid().operations[0]] })],
    ["protocolo", () => valid({ protocolVersion: 2 })],
  ])("rejeita %s", (_, factory) => expect(() => parsePushRequest(request(factory()), factory())).toThrow());

  it("rejeita quantidade e tamanho excessivos", () => {
    const tooMany = valid({ operations: Array.from({ length: 101 }, (_, index) => ({ ...valid().operations[0], mutationId: `m-${index}`, recordId: `p-${index}` })) });
    expect(() => parsePushRequest(request(tooMany), tooMany)).toThrow();
    expect(() => parsePushRequest(request(valid(), { "Content-Length": String(MAX_PUSH_BYTES + 1) }), valid())).toThrow();
  });

  it("exige comandos semânticos para exclusões coletivas", () => {
    const deletion = valid({ operations: [{ command: "delete-record", mutationId: "mutation-1", entityType: "series", recordId: "series-1", baseVersion: 1 }] });
    expect(() => parsePushRequest(request(deletion), deletion)).toThrow(/semântica/);
  });

  it("valida occurrenceKey, séries, parcelas e referências por formato", () => {
    expect(() => validateEntityPayload("transaction", {
      profileId: "profile", seriesId: "series", occurrenceKey: "series:1", description: "Parcela", amountCents: 100,
      type: "expense", status: "pending", dueDate: "2028-01-31", categoryId: "category", categoryName: "Casa", notes: "", kind: "installment", installmentCurrent: 1, installmentTotal: 2,
    })).not.toThrow();
    expect(() => validateEntityPayload("transaction", {
      profileId: "profile", seriesId: "series", occurrenceKey: "manipulada", description: "Parcela", amountCents: 100,
      type: "expense", status: "pending", dueDate: "2028-01-31", categoryId: "category", categoryName: "Casa", notes: "", kind: "installment", installmentCurrent: 1, installmentTotal: 2,
    })).toThrow();
  });

  it("valida paginação e rejeita parâmetros desconhecidos", () => {
    expect(parsePullRequest(new Request("https://app.test/api/sync/pull?cursor=0&limit=200&epoch=1&deviceId=device&protocolVersion=1"))).toMatchObject({ limit: 200 });
    expect(parsePullRequest(new Request("https://app.test/api/sync/pull?cursor=100&untilRevision=120&limit=20&epoch=1&deviceId=device&protocolVersion=1"))).toMatchObject({ cursor: 100, untilRevision: 120 });
    expect(() => parsePullRequest(new Request("https://app.test/api/sync/pull?cursor=0&limit=201&epoch=1&deviceId=device&protocolVersion=1"))).toThrow();
    expect(() => parsePullRequest(new Request("https://app.test/api/sync/pull?cursor=0&limit=1&epoch=1&deviceId=device&protocolVersion=1&ownerUid=other"))).toThrow();
  });
});
