-- Group rotating refresh tokens into a login family.
--
-- Refresh rotation revokes only the presented token. Without a family id, a
-- token rotated while sign-out was in flight could survive logout and restore
-- the browser session on reload. Login starts a new family; refresh keeps it;
-- logout revokes every still-active member of the presented token's family.
-- Existing rows form single-token families (their siblings are already
-- revoked), so upgrading a live volume needs no data backfill beyond this.

ALTER TABLE auth_refresh_tokens
  ADD COLUMN IF NOT EXISTS family_id uuid;

UPDATE auth_refresh_tokens SET family_id = id WHERE family_id IS NULL;

ALTER TABLE auth_refresh_tokens ALTER COLUMN family_id SET DEFAULT gen_random_uuid();
ALTER TABLE auth_refresh_tokens ALTER COLUMN family_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_family
  ON auth_refresh_tokens(family_id) WHERE revoked_at IS NULL;
