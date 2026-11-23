-- Crash state guards and Gin Rummy win attribution (migration 0010).
--
-- Every statement here is idempotent: an overlapping recovery migration may
-- already have added part of the schema. The service derives round deadlines
-- from these persisted columns, so a restart can finish/cancel stale rounds
-- instead of leaving them cashable at the published crash point.

ALTER TABLE crash_rounds
  ADD COLUMN IF NOT EXISTS house_edge numeric(6,5) NOT NULL DEFAULT 0.02,
  ADD COLUMN IF NOT EXISTS max_multiplier numeric(10,2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS doubling_seconds numeric(6,2) NOT NULL DEFAULT 3;

-- `pending`  = bet reserved, wallet debit in flight/ambiguous.
-- `cashing_out` = payout amount committed, wallet credit in flight/ambiguous.
-- Both are reconciled with deterministic wallet idempotency keys on boot.
ALTER TABLE crash_bets
  DROP CONSTRAINT IF EXISTS crash_bets_status_check;
ALTER TABLE crash_bets
  ADD CONSTRAINT crash_bets_status_check
    CHECK (status IN ('pending','active','cashing_out','cashed_out','lost','cancelled','refunded'));

CREATE INDEX IF NOT EXISTS idx_crash_bets_status ON crash_bets (status);

-- Older data can contain several active rounds. Keep only the newest so the
-- single-live-round partial index below can be created safely.
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

-- Only a hand-validated /meld win may score on the leaderboard. A /end
-- concession is explicitly marked as such. Historical rows default to
-- 'concession' because their win cannot be validated retroactively.
ALTER TABLE gin_rummy_games
  ADD COLUMN IF NOT EXISTS win_type text NOT NULL DEFAULT 'concession';
UPDATE gin_rummy_games SET win_type = 'concession' WHERE win_type IS NULL;
ALTER TABLE gin_rummy_games ALTER COLUMN win_type SET NOT NULL;
ALTER TABLE gin_rummy_games
  DROP CONSTRAINT IF EXISTS gin_rummy_games_win_type_check;
ALTER TABLE gin_rummy_games
  ADD CONSTRAINT gin_rummy_games_win_type_check
    CHECK (win_type IN ('validated','concession'));
