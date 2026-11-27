-- Access-token uniqueness and immediate revocation.
--
-- Access tokens are RS256-signed and rotate with `auth_users.token_version`.
-- Recording each jti lets the edge reject a replayed or revoked token instead
-- of trusting only its signature until natural expiry.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE auth_users
  ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS auth_access_tokens (
  jti           uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token_version integer NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_auth_access_tokens_user
  ON auth_access_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_access_tokens_expires
  ON auth_access_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_access_tokens_active
  ON auth_access_tokens(user_id, expires_at) WHERE revoked_at IS NULL;
