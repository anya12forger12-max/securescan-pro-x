-- Aviator reference features (migration 0019).
--
-- Double bet: two independent panels share a round and one crash point but
-- keep separate stakes, targets and settlements. Existing rows stay panel 1 so
-- the upgrade never changes the economics of an in-flight bet.
ALTER TABLE crash_bets
  ADD COLUMN IF NOT EXISTS panel smallint NOT NULL DEFAULT 1;
UPDATE crash_bets SET panel = 1 WHERE panel IS NULL;
ALTER TABLE crash_bets
  DROP CONSTRAINT IF EXISTS crash_bets_panel_check;
ALTER TABLE crash_bets
  ADD CONSTRAINT crash_bets_panel_check CHECK (panel IN (1, 2));
ALTER TABLE crash_bets
  DROP CONSTRAINT IF EXISTS crash_bets_one_per_user_per_round;
ALTER TABLE crash_bets
  DROP CONSTRAINT IF EXISTS crash_bets_one_per_user_per_panel;
ALTER TABLE crash_bets
  ADD CONSTRAINT crash_bets_one_per_user_per_panel UNIQUE (round_id, user_id, panel);
CREATE INDEX IF NOT EXISTS idx_crash_bets_round_user_panel
  ON crash_bets (round_id, user_id, panel);

-- Player settings hold UI preferences (sound, theme, language) together with
-- operator policy (blocked flag and bet limits). Only the operator endpoints
-- can write the policy fields; every wager reads them through wageringAllowed().
CREATE TABLE IF NOT EXISTS crash_player_settings (
  user_id  text PRIMARY KEY,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Auto-bet sessions. Every round still goes through the normal bet path, so
-- limits, RG checks, wallet idempotency and settlement are identical to a
-- manual bet. `last_round_id` prevents a restart from placing a second stake
-- in the same round.
CREATE TABLE IF NOT EXISTS crash_auto_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  panel         smallint NOT NULL CHECK (panel IN (1, 2)),
  stake         numeric(18,2) NOT NULL CHECK (stake > 0),
  auto_cashout  numeric(10,2) CHECK (auto_cashout IS NULL OR auto_cashout >= 1.01),
  rounds_left   integer NOT NULL CHECK (rounds_left > 0),
  stop_rules    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','stopped')),
  last_round_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, panel)
);
CREATE INDEX IF NOT EXISTS idx_crash_auto_active ON crash_auto_sessions (status, created_at);
