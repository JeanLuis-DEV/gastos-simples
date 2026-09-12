PRAGMA foreign_keys = ON;

CREATE TABLE users (
  firebase_uid TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  public_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE subscriptions (
  firebase_uid TEXT PRIMARY KEY REFERENCES users(firebase_uid) ON DELETE CASCADE,
  mp_subscription_id TEXT UNIQUE,
  plan_id TEXT,
  status_normalized TEXT NOT NULL,
  status_original TEXT NOT NULL,
  trial_end_at TEXT,
  end_at TEXT,
  next_payment_at TEXT,
  provider_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL
);

CREATE TABLE webhook_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  result TEXT NOT NULL
);

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, bucket)
);

CREATE INDEX subscriptions_status_idx ON subscriptions(status_normalized);
CREATE INDEX webhook_resource_idx ON webhook_events(resource_id);
