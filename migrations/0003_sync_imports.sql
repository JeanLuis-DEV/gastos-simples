PRAGMA foreign_keys = ON;

CREATE TABLE sync_import_sessions (
  firebase_uid TEXT NOT NULL REFERENCES sync_accounts(firebase_uid) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('merge', 'replace')),
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  status TEXT NOT NULL CHECK (status IN ('open', 'committed', 'aborted')),
  next_chunk INTEGER NOT NULL DEFAULT 0 CHECK (next_chunk >= 0),
  record_count INTEGER NOT NULL DEFAULT 0 CHECK (record_count >= 0 AND record_count <= 111600),
  result_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (firebase_uid, session_id)
);

CREATE TABLE sync_import_records (
  firebase_uid TEXT NOT NULL,
  session_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('profile', 'category', 'series', 'seriesSegment', 'transaction', 'calculator')),
  record_id TEXT NOT NULL,
  structural_json TEXT NOT NULL,
  payload_ciphertext TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  key_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (firebase_uid, session_id, entity_type, record_id),
  FOREIGN KEY (firebase_uid, session_id) REFERENCES sync_import_sessions(firebase_uid, session_id) ON DELETE CASCADE
);

CREATE TABLE sync_import_chunks (
  firebase_uid TEXT NOT NULL,
  session_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (firebase_uid, session_id, chunk_index),
  FOREIGN KEY (firebase_uid, session_id) REFERENCES sync_import_sessions(firebase_uid, session_id) ON DELETE CASCADE
);

CREATE INDEX sync_import_sessions_expiry_idx ON sync_import_sessions(status, expires_at);
CREATE INDEX sync_import_records_session_idx ON sync_import_records(firebase_uid, session_id, entity_type, record_id);
