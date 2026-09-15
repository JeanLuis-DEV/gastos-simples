export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta?: { changes?: number };
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
export type Env = {
  DB: D1Database;
  FIREBASE_PROJECT_ID: string;
  ADMIN_FIREBASE_UIDS?: string;
  MERCADO_PAGO_ACCESS_TOKEN: string;
  MERCADO_PAGO_PLAN_ID: string;
  MERCADO_PAGO_PUBLIC_KEY?: string;
  MERCADO_PAGO_TEST_PAYER_EMAIL?: string;
  MERCADO_PAGO_WEBHOOK_SECRET?: string;
  APP_ORIGIN: string;
  SYNC_ENABLED?: string;
  SYNC_ACTIVE_KEY_ID?: string;
  SYNC_ENCRYPTION_KEYS?: string;
};
export type PagesContext = {
  request: Request;
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
};
export type AuthIdentity = { uid: string; email: string; name?: string; authTime?: number };
