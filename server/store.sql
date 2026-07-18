-- Phase 3 schema. Applied by PgStore.init(). Idempotent so a restart is safe.

CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  username_lc TEXT NOT NULL UNIQUE,        -- lower(username): the uniqueness key
  pw_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions(account_id);

CREATE TABLE IF NOT EXISTS characters (
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slot SMALLINT NOT NULL,
  name TEXT NOT NULL,
  data JSONB NOT NULL,
  version INT NOT NULL DEFAULT 1,
  imported BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, slot)
);
