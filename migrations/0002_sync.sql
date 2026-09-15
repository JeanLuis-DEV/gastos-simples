PRAGMA foreign_keys = ON;

CREATE TABLE sync_accounts (
  firebase_uid TEXT PRIMARY KEY REFERENCES users(firebase_uid) ON DELETE CASCADE,
  sync_epoch INTEGER NOT NULL DEFAULT 1 CHECK (sync_epoch >= 1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  activated_at TEXT,
  disabled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sync_activations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  firebase_uid TEXT NOT NULL REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('activated', 'disabled_keep', 'disabled_delete_requested', 'reactivated')),
  occurred_at TEXT NOT NULL
);

CREATE TABLE sync_devices (
  firebase_uid TEXT NOT NULL REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  protocol_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (firebase_uid, device_id)
);

CREATE TABLE sync_profiles (
  firebase_uid TEXT NOT NULL REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  deleted_at TEXT,
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  key_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (firebase_uid, record_id)
);

CREATE TABLE sync_categories (
  firebase_uid TEXT NOT NULL REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('expense', 'income')),
  version INTEGER NOT NULL CHECK (version >= 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  deleted_at TEXT,
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  key_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (firebase_uid, record_id),
  UNIQUE (firebase_uid, canonical_key)
);

CREATE TABLE sync_series (
  firebase_uid TEXT NOT NULL REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('recurring', 'installment')),
  start_date TEXT NOT NULL,
  end_before TEXT,
  installment_total INTEGER,
  version INTEGER NOT NULL CHECK (version >= 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  deleted_at TEXT,
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  key_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (firebase_uid, record_id)
);

CREATE TABLE sync_series_segments (
  firebase_uid TEXT NOT NULL,
  record_id TEXT NOT NULL,
  series_id TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  anchor_due_date TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('expense', 'income')),
  version INTEGER NOT NULL CHECK (version >= 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  deleted_at TEXT,
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  key_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (firebase_uid, record_id),
  UNIQUE (firebase_uid, series_id, effective_from),
  FOREIGN KEY (firebase_uid) REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  FOREIGN KEY (firebase_uid, series_id) REFERENCES sync_series(firebase_uid, record_id),
  FOREIGN KEY (firebase_uid, profile_id) REFERENCES sync_profiles(firebase_uid, record_id),
  FOREIGN KEY (firebase_uid, category_id) REFERENCES sync_categories(firebase_uid, record_id)
);

CREATE TABLE sync_transactions (
  firebase_uid TEXT NOT NULL,
  record_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  series_id TEXT,
  occurrence_key TEXT NOT NULL,
  due_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('single', 'recurring', 'installment')),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('expense', 'income')),
  version INTEGER NOT NULL CHECK (version >= 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  deleted_at TEXT,
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  key_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (firebase_uid, record_id),
  UNIQUE (firebase_uid, occurrence_key),
  FOREIGN KEY (firebase_uid) REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  FOREIGN KEY (firebase_uid, profile_id) REFERENCES sync_profiles(firebase_uid, record_id),
  FOREIGN KEY (firebase_uid, category_id) REFERENCES sync_categories(firebase_uid, record_id),
  FOREIGN KEY (firebase_uid, series_id) REFERENCES sync_series(firebase_uid, record_id)
);

CREATE TABLE sync_calculator_entries (
  firebase_uid TEXT NOT NULL REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  deleted_at TEXT,
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  key_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (firebase_uid, record_id)
);

CREATE TABLE sync_changes (
  firebase_uid TEXT NOT NULL REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('profile', 'category', 'series', 'seriesSegment', 'transaction', 'calculator')),
  record_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  is_deleted INTEGER NOT NULL CHECK (is_deleted IN (0, 1)),
  deleted_at TEXT,
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  key_id TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  PRIMARY KEY (firebase_uid, revision)
);

CREATE TABLE sync_tombstones (
  firebase_uid TEXT NOT NULL REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (firebase_uid, entity_type, record_id)
);

CREATE TABLE sync_record_aliases (
  firebase_uid TEXT NOT NULL REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('category', 'transaction')),
  alias_id TEXT NOT NULL,
  canonical_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (firebase_uid, entity_type, alias_id)
);

CREATE TABLE sync_batches (
  firebase_uid TEXT NOT NULL REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (firebase_uid, batch_id)
);

CREATE TABLE sync_mutation_receipts (
  firebase_uid TEXT NOT NULL REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  mutation_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (firebase_uid, mutation_id),
  FOREIGN KEY (firebase_uid, batch_id) REFERENCES sync_batches(firebase_uid, batch_id) ON DELETE CASCADE
);

CREATE TABLE sync_base_snapshots (
  firebase_uid TEXT NOT NULL REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  server_version INTEGER NOT NULL,
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  key_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (firebase_uid, entity_type, record_id)
);

CREATE TABLE sync_conflicts (
  firebase_uid TEXT NOT NULL REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  conflict_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  conflicting_fields_json TEXT NOT NULL,
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  key_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  PRIMARY KEY (firebase_uid, conflict_id)
);

CREATE TABLE sync_retention (
  firebase_uid TEXT PRIMARY KEY REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  entitlement_status TEXT NOT NULL,
  became_ineligible_at TEXT,
  purge_after TEXT,
  reactivated_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE sync_deletion_nonces (
  firebase_uid TEXT NOT NULL REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  nonce_hash TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  auth_time INTEGER NOT NULL,
  PRIMARY KEY (firebase_uid, nonce_hash)
);

CREATE TABLE sync_deletion_requests (
  firebase_uid TEXT NOT NULL REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  resulting_epoch INTEGER,
  PRIMARY KEY (firebase_uid, request_id)
);

CREATE TABLE sync_write_guards (
  firebase_uid TEXT NOT NULL REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  valid INTEGER NOT NULL CHECK (valid = 1),
  PRIMARY KEY (firebase_uid, request_id)
);

CREATE INDEX sync_activations_uid_time_idx ON sync_activations(firebase_uid, occurred_at);
CREATE INDEX sync_devices_last_seen_idx ON sync_devices(firebase_uid, last_seen_at);
CREATE INDEX sync_profiles_revision_idx ON sync_profiles(firebase_uid, revision);
CREATE INDEX sync_categories_revision_idx ON sync_categories(firebase_uid, revision);
CREATE INDEX sync_series_revision_idx ON sync_series(firebase_uid, revision);
CREATE INDEX sync_segments_series_idx ON sync_series_segments(firebase_uid, series_id, effective_from);
CREATE INDEX sync_segments_revision_idx ON sync_series_segments(firebase_uid, revision);
CREATE INDEX sync_transactions_series_due_idx ON sync_transactions(firebase_uid, series_id, due_date);
CREATE INDEX sync_transactions_revision_idx ON sync_transactions(firebase_uid, revision);
CREATE INDEX sync_calculator_revision_idx ON sync_calculator_entries(firebase_uid, revision);
CREATE INDEX sync_changes_pull_idx ON sync_changes(firebase_uid, revision);
CREATE INDEX sync_tombstones_revision_idx ON sync_tombstones(firebase_uid, revision);
CREATE INDEX sync_aliases_canonical_idx ON sync_record_aliases(firebase_uid, entity_type, canonical_id);
CREATE INDEX sync_mutations_batch_idx ON sync_mutation_receipts(firebase_uid, batch_id);
CREATE INDEX sync_conflicts_open_idx ON sync_conflicts(firebase_uid, resolved_at, created_at);
CREATE INDEX sync_retention_purge_idx ON sync_retention(purge_after);
CREATE INDEX sync_nonces_expiry_idx ON sync_deletion_nonces(firebase_uid, expires_at, used_at);
