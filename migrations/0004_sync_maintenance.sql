PRAGMA foreign_keys = ON;

ALTER TABLE sync_accounts ADD COLUMN min_available_revision INTEGER NOT NULL DEFAULT 0 CHECK (min_available_revision >= 0);
ALTER TABLE sync_accounts ADD COLUMN consent_version INTEGER;
ALTER TABLE sync_accounts ADD COLUMN consent_accepted_at TEXT;
ALTER TABLE sync_activations ADD COLUMN consent_version INTEGER;
ALTER TABLE sync_activations ADD COLUMN policy_version TEXT;

CREATE TABLE sync_maintenance_runs (
  request_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial_failure', 'failed')),
  metrics_json TEXT,
  error_code TEXT
);

CREATE INDEX sync_changes_changed_at_idx ON sync_changes(firebase_uid, changed_at, revision);
CREATE INDEX sync_nonces_global_expiry_idx ON sync_deletion_nonces(expires_at);
CREATE INDEX sync_retention_global_purge_idx ON sync_retention(purge_after, firebase_uid);
