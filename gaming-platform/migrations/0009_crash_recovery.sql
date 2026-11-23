-- Crash recovery hardening.
--
-- Bets now pass through `pending` (stake debit in flight/ambiguous) and
-- `cashing_out` (wallet credited, bet status not yet finalised). Both states
-- must survive a process restart so they can be reconciled idempotently.
ALTER TABLE crash_rounds
  ADD COLUMN IF NOT EXISTS house_edge numeric(6,5) NOT NULL DEFAULT 0.02,
  ADD COLUMN IF NOT EXISTS max_multiplier numeric(10,2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS doubling_seconds numeric(6,2) NOT NULL DEFAULT 3;

ALTER TABLE crash_bets
  DROP CONSTRAINT IF EXISTS crash_bets_status_check;
ALTER TABLE crash_bets
  ADD CONSTRAINT crash_bets_status_check
    CHECK (status IN ('pending','active','cashing_out','cashed_out','lost','cancelled','refunded'));

-- Older data may contain several active rounds from the pre-recovery code.
-- Keep only the newest and cancel the rest before enforcing a single active
-- round; otherwise the partial unique index cannot be created.
UPDATE crash_rounds
   SET status = 'cancelled', finished_at = now()
 WHERE status IN ('betting','running')
   AND id <> (
     SELECT id FROM crash_rounds
      WHERE status IN ('betting','running')
      ORDER BY created_at DESC LIMIT 1
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_crash_one_active_round
  ON crash_rounds ((1)) WHERE status IN ('betting','running');
