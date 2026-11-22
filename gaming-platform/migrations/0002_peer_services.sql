-- Peer services added after the initial recovery slice:
-- wallet (3011), responsible-gaming (3012), realtime (3010, no DB),
-- tournaments (3014).

-- ---------------------------------------------------------------------------
-- Wallet (3011)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_accounts (
  user_id    text PRIMARY KEY,
  balance    numeric(18,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  user_id        text NOT NULL REFERENCES wallet_accounts(user_id),
  amount         numeric(18,2) NOT NULL CHECK (amount > 0),
  type           text NOT NULL CHECK (type IN ('bonus','deposit','win','adjustment')),
  reference_type text NOT NULL,
  reference_id   text,
  balance_after  numeric(18,2) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_created ON wallet_transactions(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Responsible gaming (3012)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rg_self_exclusions (
  user_id    text PRIMARY KEY,
  active     boolean NOT NULL DEFAULT true,
  reason     text NOT NULL DEFAULT 'self-requested exclusion',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE TABLE IF NOT EXISTS rg_check_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text NOT NULL,
  action     text NOT NULL,
  amount     numeric(18,2),
  allowed    boolean NOT NULL,
  reason     text,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rg_check_user_time ON rg_check_audit(user_id, checked_at DESC);

-- ---------------------------------------------------------------------------
-- Tournaments (3014)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tournaments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type   text NOT NULL CHECK (game_type IN ('crash','roulette','slot','pictionary','codenames','gin-rummy')),
  title       text NOT NULL,
  max_players integer NOT NULL CHECK (max_players >= 2),
  entry_fee   numeric(18,2) NOT NULL DEFAULT 0,
  prize_pool  numeric(18,2) NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'registering'
                CHECK (status IN ('registering','active','ended','cancelled')),
  starts_at   timestamptz,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_players (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id       text NOT NULL,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_players_user ON tournament_players(user_id);
