-- Gaming platform initial schema.
-- Every table below is derived from the queries in services/*/dist/db.js and
-- services/promotions/dist/repo.js. Safe to run against a fresh database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Core game sessions (game-engine, leaderboard verification)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type  text NOT NULL CHECK (game_type IN ('crash','roulette','slot','pictionary','codenames','gin-rummy')),
  status     text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','active','ended','cancelled')),
  host_id    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz
);

CREATE TABLE IF NOT EXISTS game_players (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  user_id    text NOT NULL,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(user_id);

-- ---------------------------------------------------------------------------
-- Chat (3016)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_rooms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room       text NOT NULL,
  user_id    text NOT NULL,
  username   text NOT NULL,
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created ON chat_messages(room, created_at DESC);

-- ---------------------------------------------------------------------------
-- Codenames (3017)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS codenames_games (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid REFERENCES game_sessions(id) ON DELETE SET NULL,
  host_id         text NOT NULL,
  red_team_words  text[] NOT NULL DEFAULT '{}',
  blue_team_words text[] NOT NULL DEFAULT '{}',
  neutral_words   text[] NOT NULL DEFAULT '{}',
  assassin_word   text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'waiting',
  current_team    text NOT NULL DEFAULT 'red',
  created_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz
);

CREATE TABLE IF NOT EXISTS codenames_clues (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id      uuid NOT NULL REFERENCES codenames_games(id) ON DELETE CASCADE,
  spymaster_id text NOT NULL,
  word         text NOT NULL,
  number       integer NOT NULL CHECK (number > 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_codenames_clues_game ON codenames_clues(game_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Gin Rummy (3019)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gin_rummy_games (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid REFERENCES game_sessions(id) ON DELETE SET NULL,
  player1_id   text NOT NULL,
  player2_id   text,
  player1_hand jsonb NOT NULL DEFAULT '[]'::jsonb,
  player2_hand jsonb NOT NULL DEFAULT '[]'::jsonb,
  discard_pile jsonb NOT NULL DEFAULT '[]'::jsonb,
  stock_pile   jsonb NOT NULL DEFAULT '[]'::jsonb,
  status       text NOT NULL DEFAULT 'waiting',
  current_turn text,
  winner_id    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz
);

-- ---------------------------------------------------------------------------
-- Pictionary (3021)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pictionary_words (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  word       text NOT NULL UNIQUE,
  difficulty text NOT NULL DEFAULT 'medium',
  category   text NOT NULL DEFAULT 'general'
);

CREATE TABLE IF NOT EXISTS pictionary_rounds (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES game_sessions(id) ON DELETE SET NULL,
  word       text NOT NULL,
  drawer_id  text NOT NULL,
  status     text NOT NULL DEFAULT 'drawing' CHECK (status IN ('drawing','ended')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz,
  winner_id  text
);

CREATE TABLE IF NOT EXISTS pictionary_guesses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id   uuid NOT NULL REFERENCES pictionary_rounds(id) ON DELETE CASCADE,
  user_id    text NOT NULL,
  username   text NOT NULL,
  guess      text NOT NULL,
  correct    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pictionary_guesses_round ON pictionary_guesses(round_id, created_at);

-- ---------------------------------------------------------------------------
-- Leaderboard (3020)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text NOT NULL,
  username   text NOT NULL,
  game_type  text NOT NULL,
  score      integer NOT NULL,
  session_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_game_score ON leaderboard_entries(game_type, score DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_user ON leaderboard_entries(user_id, game_type);

-- ---------------------------------------------------------------------------
-- Promotions (3022)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS promotions;

CREATE TABLE IF NOT EXISTS promotions.promotions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL UNIQUE,
  type                 text NOT NULL CHECK (type IN ('deposit_bonus','free_bet','cashback')),
  title                text NOT NULL,
  description          text NOT NULL DEFAULT '',
  bonus_amount         numeric(18,2) NOT NULL CHECK (bonus_amount > 0),
  wagering_requirement numeric(10,4) NOT NULL DEFAULT 0,
  max_claims           integer NOT NULL CHECK (max_claims > 0),
  claims_count         integer NOT NULL DEFAULT 0,
  starts_at            timestamptz NOT NULL,
  expires_at           timestamptz NOT NULL,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > starts_at)
);

CREATE TABLE IF NOT EXISTS promotions.promotion_claims (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id      uuid NOT NULL REFERENCES promotions.promotions(id) ON DELETE CASCADE,
  user_id           text NOT NULL,
  claimed_at        timestamptz NOT NULL DEFAULT now(),
  bonus_amount      numeric(18,2) NOT NULL,
  wagering_progress numeric(18,2) NOT NULL DEFAULT 0,
  wagering_target   numeric(18,2) NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'active',
  UNIQUE (user_id, promotion_id)
);

CREATE INDEX IF NOT EXISTS idx_promotion_claims_promotion ON promotions.promotion_claims(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promotion_claims_user ON promotions.promotion_claims(user_id, claimed_at DESC);

-- Seed words so POST /v1/pictionary/rounds works on a fresh database.
INSERT INTO pictionary_words (word, difficulty, category) VALUES
  ('rocket',    'easy',   'space'),
  ('planet',    'easy',   'space'),
  ('mountain',  'easy',   'nature'),
  ('umbrella',  'easy',   'objects'),
  ('bicycle',   'medium', 'objects'),
  ('lighthouse','medium', 'places'),
  ('dragon',    'medium', 'fantasy'),
  ('guitar',    'medium', 'music'),
  ('telescope', 'hard',   'science'),
  ('labyrinth', 'hard',   'places'),
  ('kaleidoscope','hard', 'objects'),
  ('phoenix',   'hard',   'fantasy')
ON CONFLICT (word) DO NOTHING;
