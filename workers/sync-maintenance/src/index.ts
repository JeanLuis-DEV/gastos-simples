import { runMaintenance, type D1Database, type MaintenanceConfig } from "./maintenance";

type Env = {
  SYNC_DB: D1Database;
  ACCOUNT_LIMIT?: string;
  TOMBSTONE_RETENTION_DAYS?: string;
  TECHNICAL_RETENTION_DAYS?: string;
  COMPACTION_ENABLED?: string;
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default {
  async scheduled(_controller: unknown, env: Env, context: { waitUntil(promise: Promise<unknown>): void }) {
    const requestId = crypto.randomUUID();
    const config: MaintenanceConfig = {
      accountLimit: Math.min(100, positiveInteger(env.ACCOUNT_LIMIT, 25)),
      tombstoneRetentionDays: positiveInteger(env.TOMBSTONE_RETENTION_DAYS, 180),
      technicalRetentionDays: positiveInteger(env.TECHNICAL_RETENTION_DAYS, 180),
      compactionEnabled: env.COMPACTION_ENABLED === "true",
    };
    context.waitUntil(runMaintenance(env.SYNC_DB, new Date(), requestId, config).then((metrics) => {
      console.log(JSON.stringify(metrics));
    }).catch(() => {
      console.error(JSON.stringify({ requestId, code: "maintenance_unhandled_failure" }));
    }));
  },
};
