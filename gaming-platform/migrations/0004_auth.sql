-- Auth service (3015): user credentials and rotating refresh tokens.
-- gen_random_uuid() comes from pgcrypto (created in 0001_init.sql); keep the
-- extension guard so this migration is also safe to apply on its own.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Users. Only password_hash is stored; plaintext passwords never touch the DB.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Refresh tokens. The raw token is returned to the client once and discarded;
-- only its SHA-256 hash is persisted. Rotation sets revoked_at on the old row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- username, email and token_hash already have UNIQUE indexes from their
-- constraints. These cover the lookup/rotation and cleanup access patterns.
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user ON auth_refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_expires ON auth_refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_active
  ON auth_refresh_tokens(user_id, expires_at) WHERE revoked_at IS NULL;
