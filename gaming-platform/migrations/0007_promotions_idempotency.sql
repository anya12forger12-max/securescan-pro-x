-- A promotion claim needs a stable wallet idempotency key that survives a
-- claim rollback after an ambiguous wallet response. The old code derived the
-- key from the claim UUID, so a retry created a new key and could pay twice.

ALTER TABLE promotions.promotion_claims
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Claims created before this migration used `promo-claim-<claim uuid>`, which
-- is already unique and is what those wallet transactions actually recorded.
UPDATE promotions.promotion_claims
   SET idempotency_key = 'promo-claim-' || id::text
 WHERE idempotency_key IS NULL;

ALTER TABLE promotions.promotion_claims
  ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_promotion_claims_idempotency_key
  ON promotions.promotion_claims (idempotency_key);
