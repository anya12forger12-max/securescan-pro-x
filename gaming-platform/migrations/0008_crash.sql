-- Unified Aviator/crash game (migration 0008).
--
-- The four vendored Aviator projects had no authoritative scoring backend, so
-- the platform previously rejected `crash` sessions as unscorable. This adds a
-- provably-fair round ledger and per-user bet lifecycle that the wallet and
-- leaderboard can verify.

CREATE TABLE IF NOT EXISTS crash_rounds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_hash    text NOT NULL,                    -- sha256(server_seed), published before betting
  server_seed  text,                             -- revealed only after the round finishes
  crash_point  numeric(10,2),                    -- revealed only after the round finishes
  status       text NOT NULL DEFAULT 'betting'
                 CHECK (status IN ('betting','running','finished','cancelled')),
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crash_rounds_status_created
  ON crash_rounds (status, created_at DESC);

CREATE TABLE IF NOT EXISTS crash_bets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id        uuid NOT NULL REFERENCES crash_rounds(id) ON DELETE CASCADE,
  -- Optional link to a game-engine session so leaderboard scores can only be
  -- claimed for a verified cash-out inside a real session.
  session_id      uuid REFERENCES game_sessions(id) ON DELETE SET NULL,
  user_id         text NOT NULL,
  amount          numeric(18,2) NOT NULL CHECK (amount > 0),
  auto_cashout    numeric(10,2) CHECK (auto_cashout IS NULL OR auto_cashout >= 1),
  cashout_at      numeric(10,2),                 -- multiplier at cash-out
  payout          numeric(18,2),
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','cashed_out','lost','cancelled','refunded')),
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  settled_at      timestamptz,
  CONSTRAINT crash_bets_one_per_user_per_round UNIQUE (round_id, user_id),
  CONSTRAINT crash_bets_cashed_out_fields
    CHECK (status <> 'cashed_out' OR (cashout_at IS NOT NULL AND payout IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_crash_bets_user_created ON crash_bets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crash_bets_round ON crash_bets (round_id);

-- A wager is a negative wallet transaction. The old constraints required every
-- amount to be positive and limited types to credit-only values; widen them so
-- the crash service can debit on bet placement and credit on cash-out with the
-- same idempotency guarantees promotions already relies on.
ALTER TABLE wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_amount_check;
ALTER TABLE wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_type_check
    CHECK (type IN ('bonus','deposit','win','adjustment','wager'));
ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_amount_check
    CHECK ((type = 'wager' AND amount < 0) OR (type <> 'wager' AND amount > 0));

-- Tournaments should be able to host the newly integrated games.
ALTER TABLE tournaments
  DROP CONSTRAINT IF EXISTS tournaments_game_type_check;
ALTER TABLE tournaments
  ADD CONSTRAINT tournaments_game_type_check
    CHECK (game_type IN ('crash','dice','flip','jackpot','wheel',
                         'roulette','slot','pictionary','codenames','gin-rummy'));
