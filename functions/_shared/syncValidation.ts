import { HttpError } from "./http";

export const SYNC_PROTOCOL_VERSION = 1;
export const MAX_PUSH_OPERATIONS = 100;
export const MAX_PUSH_BYTES = 256 * 1024;
export const MAX_PULL_RECORDS = 200;
export const MAX_PULL_BYTES = 512 * 1024;

export type SyncEntityType = "profile" | "category" | "series" | "seriesSegment" | "transaction" | "calculator";
export type RecordCommand = {
  command: "upsert-record" | "delete-record";
  mutationId: string;
  entityType: SyncEntityType;
  recordId: string;
  baseVersion: number;
  payload?: Record<string, unknown>;
  baseSnapshot?: Record<string, unknown>;
};
export type SeriesFutureCommand = {
  command: "delete-series-future" | "edit-series-future";
  mutationId: string;
  entityType: "series";
  recordId: string;
  baseVersion: number;
  effectiveFrom: string;
  changes?: Record<string, unknown>;
};
export type ProfileTransferCommand = {
  command: "delete-profile-and-transfer";
  mutationId: string;
  recordId: string;
  destinationProfileId: string;
  baseVersion: number;
};
export type ResetCommand = { command: "reset-account-data"; mutationId: string; baseRevision: number };
export type ImportReplaceCommand = {
  command: "import-replace";
  mutationId: string;
  baseRevision: number;
  records: Array<{ entityType: SyncEntityType; recordId: string; payload: Record<string, unknown> }>;
};
export type RestructureSeriesCommand = {
  command: "restructure-series";
  mutationId: string;
  recordId: string;
  baseVersion: number;
  effectiveFrom: string;
  replacement: Record<string, unknown>;
};
export type PushCommand = RecordCommand | SeriesFutureCommand | ProfileTransferCommand | ResetCommand | ImportReplaceCommand | RestructureSeriesCommand;
export type PushRequest = {
  protocolVersion: 1;
  syncEpoch: number;
  batchId: string;
  deviceId: string;
  operations: PushCommand[];
};

const entityTypes = new Set<SyncEntityType>(["profile", "category", "series", "seriesSegment", "transaction", "calculator"]);
const civilDate = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const timestamp = /^\d{4}-\d{2}-\d{2}T/;
const id = (value: unknown) => typeof value === "string" && value.length >= 1 && value.length <= 128 && /^[A-Za-z0-9:._-]+$/.test(value);
const text = (value: unknown, max: number, required = true) => typeof value === "string" && value.length <= max && (!required || value.trim().length > 0);
const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(value, key));

function assertObject(value: unknown, message = "Solicitação inválida."): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, message);
}

function validStatus(type: unknown, status: unknown) {
  return (type === "expense" && ["pending", "paid"].includes(String(status))) ||
    (type === "income" && ["pending", "received"].includes(String(status)));
}

const payloadRules: Record<SyncEntityType, { allowed: string[]; required: string[]; validate(value: Record<string, unknown>): boolean }> = {
  profile: {
    allowed: ["name"], required: ["name"],
    validate: (value) => text(value.name, 40) && (value.name as string) === (value.name as string).trim(),
  },
  category: {
    allowed: ["name", "type", "isDefault"], required: ["name", "type", "isDefault"],
    validate: (value) => text(value.name, 40) && ["expense", "income"].includes(String(value.type)) && typeof value.isDefault === "boolean",
  },
  series: {
    allowed: ["kind", "startDate", "endBefore", "installmentTotal"], required: ["kind", "startDate"],
    validate: (value) => ["recurring", "installment"].includes(String(value.kind)) && civilDate.test(String(value.startDate)) &&
      (value.endBefore === undefined || civilDate.test(String(value.endBefore))) &&
      (value.kind === "recurring" ? value.installmentTotal === undefined : integer(value.installmentTotal, 2, 999)),
  },
  seriesSegment: {
    allowed: ["seriesId", "effectiveFrom", "anchorDueDate", "profileId", "description", "amountCents", "type", "categoryId", "categoryName", "notes"],
    required: ["seriesId", "effectiveFrom", "anchorDueDate", "profileId", "description", "amountCents", "type", "categoryId", "categoryName", "notes"],
    validate: (value) => id(value.seriesId) && civilDate.test(String(value.effectiveFrom)) && civilDate.test(String(value.anchorDueDate)) && id(value.profileId) &&
      text(value.description, 80) && integer(value.amountCents, 1) && ["expense", "income"].includes(String(value.type)) && id(value.categoryId) && text(value.categoryName, 40) && text(value.notes, 500, false),
  },
  transaction: {
    allowed: ["profileId", "seriesId", "seriesEndDate", "occurrenceKey", "description", "amountCents", "type", "status", "dueDate", "categoryId", "categoryName", "notes", "kind", "installmentCurrent", "installmentTotal", "paidAt"],
    required: ["profileId", "occurrenceKey", "description", "amountCents", "type", "status", "dueDate", "categoryId", "categoryName", "notes", "kind"],
    validate: (value) => id(value.profileId) && text(value.occurrenceKey, 180) && text(value.description, 80) && integer(value.amountCents, 1) && validStatus(value.type, value.status) &&
      civilDate.test(String(value.dueDate)) && id(value.categoryId) && text(value.categoryName, 40) && text(value.notes, 500, false) && ["single", "recurring", "installment"].includes(String(value.kind)) &&
      (value.paidAt === undefined || (text(value.paidAt, 40) && timestamp.test(String(value.paidAt)) && Number.isFinite(Date.parse(String(value.paidAt))))) &&
      (value.seriesEndDate === undefined || civilDate.test(String(value.seriesEndDate))) &&
      ((value.kind === "single" && value.seriesId === undefined && value.installmentCurrent === undefined && value.installmentTotal === undefined) ||
        (value.kind === "recurring" && id(value.seriesId) && value.installmentCurrent === undefined && value.installmentTotal === undefined && value.occurrenceKey === `${value.seriesId}:${String(value.dueDate).slice(0, 7)}`) ||
        (value.kind === "installment" && id(value.seriesId) && integer(value.installmentCurrent, 1, 999) && integer(value.installmentTotal, 2, 999) && (value.installmentCurrent as number) <= (value.installmentTotal as number) && value.occurrenceKey === `${value.seriesId}:${value.installmentCurrent}`)),
  },
  calculator: {
    allowed: ["expression", "result", "createdAt"], required: ["expression", "result", "createdAt"],
    validate: (value) => text(value.expression, 200) && text(value.result, 100) && text(value.createdAt, 40) && timestamp.test(String(value.createdAt)) && Number.isFinite(Date.parse(String(value.createdAt))),
  },
};

export function validateEntityPayload(entityType: SyncEntityType, value: unknown) {
  assertObject(value, "Dados inválidos.");
  const rule = payloadRules[entityType];
  if (!exactKeys(value, rule.allowed, rule.required) || !rule.validate(value)) throw new HttpError(400, "Dados inválidos.");
  return value;
}

export function parsePushRequest(request: Request, value: unknown): PushRequest {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_PUSH_BYTES) throw new HttpError(413, "Lote excede o tamanho permitido.");
  assertObject(value);
  if (!exactKeys(value, ["protocolVersion", "syncEpoch", "batchId", "deviceId", "operations"], ["protocolVersion", "syncEpoch", "batchId", "deviceId", "operations"]) ||
    value.protocolVersion !== SYNC_PROTOCOL_VERSION || !integer(value.syncEpoch, 1) || !id(value.batchId) || !id(value.deviceId) || !Array.isArray(value.operations) || !value.operations.length || value.operations.length > MAX_PUSH_OPERATIONS)
    throw new HttpError(400, "Solicitação de sincronização inválida.");
  const serializedBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (serializedBytes > MAX_PUSH_BYTES) throw new HttpError(413, "Lote excede o tamanho permitido.");
  const mutations = new Set<string>();
  const records = new Set<string>();
  for (const raw of value.operations) {
    assertObject(raw);
    if (!id(raw.mutationId) || mutations.has(String(raw.mutationId))) throw new HttpError(400, "Operação inválida.");
    mutations.add(String(raw.mutationId));
    if (raw.command === "upsert-record" || raw.command === "delete-record") {
      const recordKey = `${String(raw.entityType)}:${String(raw.recordId)}`;
      if (!id(raw.recordId) || !integer(raw.baseVersion, 0) || records.has(recordKey) || !exactKeys(raw, ["command", "mutationId", "entityType", "recordId", "baseVersion", "payload", "baseSnapshot"], ["command", "mutationId", "entityType", "recordId", "baseVersion", ...(raw.command === "upsert-record" ? ["payload"] : [])]) || !entityTypes.has(raw.entityType as SyncEntityType))
        throw new HttpError(400, "Operação inválida.");
      records.add(recordKey);
      if (raw.command === "delete-record" && ["profile", "series", "seriesSegment"].includes(String(raw.entityType)))
        throw new HttpError(400, "Use a operação semântica correspondente para excluir este registro.");
      if (raw.command === "upsert-record") validateEntityPayload(raw.entityType as SyncEntityType, raw.payload);
      if (raw.command === "delete-record" && raw.payload !== undefined) throw new HttpError(400, "Operação inválida.");
      if (raw.baseSnapshot !== undefined) validateEntityPayload(raw.entityType as SyncEntityType, raw.baseSnapshot);
    } else if (raw.command === "delete-series-future" || raw.command === "edit-series-future") {
      if (!id(raw.recordId) || !integer(raw.baseVersion, 0) || !exactKeys(raw, ["command", "mutationId", "entityType", "recordId", "baseVersion", "effectiveFrom", "changes"], ["command", "mutationId", "entityType", "recordId", "baseVersion", "effectiveFrom", ...(raw.command === "edit-series-future" ? ["changes"] : [])]) || raw.entityType !== "series" || !civilDate.test(String(raw.effectiveFrom)))
        throw new HttpError(400, "Operação de série inválida.");
      if (raw.command === "edit-series-future") {
        assertObject(raw.changes, "Alterações de série inválidas.");
        const allowed = ["anchorDueDate", "profileId", "description", "amountCents", "type", "categoryId", "categoryName", "notes"];
        if (!Object.keys(raw.changes).length || !exactKeys(raw.changes, allowed, []) ||
          (raw.changes.anchorDueDate !== undefined && !civilDate.test(String(raw.changes.anchorDueDate))) ||
          (raw.changes.profileId !== undefined && !id(raw.changes.profileId)) ||
          (raw.changes.description !== undefined && !text(raw.changes.description, 80)) ||
          (raw.changes.amountCents !== undefined && !integer(raw.changes.amountCents, 1)) ||
          (raw.changes.type !== undefined && !["expense", "income"].includes(String(raw.changes.type))) ||
          (raw.changes.categoryId !== undefined && !id(raw.changes.categoryId)) ||
          (raw.changes.categoryName !== undefined && !text(raw.changes.categoryName, 40)) ||
          (raw.changes.notes !== undefined && !text(raw.changes.notes, 500, false))) throw new HttpError(400, "Alterações de série inválidas.");
      }
    } else if (raw.command === "delete-profile-and-transfer") {
      if (!exactKeys(raw, ["command", "mutationId", "recordId", "destinationProfileId", "baseVersion"], ["command", "mutationId", "recordId", "destinationProfileId", "baseVersion"]) || !id(raw.recordId) || !id(raw.destinationProfileId) || raw.recordId === raw.destinationProfileId || !integer(raw.baseVersion, 1)) throw new HttpError(400, "Operação de perfil inválida.");
    } else if (raw.command === "reset-account-data") {
      if (!exactKeys(raw, ["command", "mutationId", "baseRevision"], ["command", "mutationId", "baseRevision"]) || !integer(raw.baseRevision, 0)) throw new HttpError(400, "Operação de reinício inválida.");
    } else if (raw.command === "import-replace") {
      if (!exactKeys(raw, ["command", "mutationId", "baseRevision", "records"], ["command", "mutationId", "baseRevision", "records"]) || !integer(raw.baseRevision, 0) || !Array.isArray(raw.records) || raw.records.length > MAX_PUSH_OPERATIONS) throw new HttpError(400, "Importação inválida.");
      const imported = new Set<string>();
      for (const item of raw.records) {
        assertObject(item, "Importação inválida.");
        if (!exactKeys(item, ["entityType", "recordId", "payload"], ["entityType", "recordId", "payload"]) || !entityTypes.has(item.entityType as SyncEntityType) || !id(item.recordId)) throw new HttpError(400, "Importação inválida.");
        const importedKey = `${String(item.entityType)}:${String(item.recordId)}`;
        if (imported.has(importedKey)) throw new HttpError(400, "Importação inválida.");
        imported.add(importedKey);
        validateEntityPayload(item.entityType as SyncEntityType, item.payload);
      }
    } else if (raw.command === "restructure-series") {
      if (!exactKeys(raw, ["command", "mutationId", "recordId", "baseVersion", "effectiveFrom", "replacement"], ["command", "mutationId", "recordId", "baseVersion", "effectiveFrom", "replacement"]) || !id(raw.recordId) || !integer(raw.baseVersion, 1) || !civilDate.test(String(raw.effectiveFrom))) throw new HttpError(400, "Reestruturação inválida.");
      assertObject(raw.replacement, "Reestruturação inválida.");
      const allowed = ["kind", "startDate", "profileId", "description", "amountCents", "type", "categoryId", "categoryName", "notes", "installmentTotal", "status", "paidAt"];
      const required = ["kind", "startDate", "profileId", "description", "amountCents", "type", "categoryId", "categoryName", "notes", "status"];
      if (!exactKeys(raw.replacement, allowed, required) || !["single", "recurring", "installment"].includes(String(raw.replacement.kind)) || !civilDate.test(String(raw.replacement.startDate)) || !id(raw.replacement.profileId) || !text(raw.replacement.description, 80) || !integer(raw.replacement.amountCents, 1) || !validStatus(raw.replacement.type, raw.replacement.status) || !id(raw.replacement.categoryId) || !text(raw.replacement.categoryName, 40) || !text(raw.replacement.notes, 500, false) || (raw.replacement.kind === "installment" ? !integer(raw.replacement.installmentTotal, 2, 999) : raw.replacement.installmentTotal !== undefined) || (raw.replacement.paidAt !== undefined && (!text(raw.replacement.paidAt, 40) || !timestamp.test(String(raw.replacement.paidAt))))) throw new HttpError(400, "Reestruturação inválida.");
    } else throw new HttpError(400, "Comando de sincronização inválido.");
  }
  if (value.operations.length > 1 && value.operations.some((operation) =>
    !["upsert-record", "delete-record"].includes(String((operation as Record<string, unknown>).command))))
    throw new HttpError(400, "Comandos coletivos devem usar um lote exclusivo.");
  return value as unknown as PushRequest;
}

export function parsePullRequest(request: Request) {
  const url = new URL(request.url);
  const allowed = new Set(["cursor", "untilRevision", "limit", "epoch", "deviceId", "protocolVersion"]);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) throw new HttpError(400, "Parâmetros inválidos.");
  const cursor = Number(url.searchParams.get("cursor") ?? 0);
  const untilRevisionValue = url.searchParams.get("untilRevision");
  const untilRevision = untilRevisionValue === null ? undefined : Number(untilRevisionValue);
  const limit = Number(url.searchParams.get("limit") ?? MAX_PULL_RECORDS);
  const epoch = Number(url.searchParams.get("epoch"));
  const protocolVersion = Number(url.searchParams.get("protocolVersion"));
  const deviceId = url.searchParams.get("deviceId");
  if (!integer(cursor, 0) || (untilRevision !== undefined && !integer(untilRevision, 0)) || !integer(limit, 1, MAX_PULL_RECORDS) || !integer(epoch, 1) || protocolVersion !== SYNC_PROTOCOL_VERSION || !id(deviceId)) throw new HttpError(400, "Parâmetros inválidos.");
  return { cursor, untilRevision, limit, epoch, deviceId: deviceId!, protocolVersion };
}
