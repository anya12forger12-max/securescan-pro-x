-- Gameplay persistence added after the initial schema:
-- Codenames guesses/reveals and the Gin Rummy draw -> discard turn state.

-- ---------------------------------------------------------------------------
-- Codenames (3017)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS codenames_guesses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    uuid NOT NULL REFERENCES codenames_games(id) ON DELETE CASCADE,
  user_id    text NOT NULL,
  username   text NOT NULL,
  word       text NOT NULL,
  team       text NOT NULL CHECK (team IN ('red','blue')),
  outcome    text NOT NULL CHECK (outcome IN ('correct','wrong_team','neutral','assassin','invalid_word')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only revealed words are sent to clients; the secret board stays on the game
-- row and is stripped before any game response is returned.
CREATE TABLE IF NOT EXISTS codenames_revealed (
  game_id     uuid NOT NULL REFERENCES codenames_games(id) ON DELETE CASCADE,
  word        text NOT NULL,
  team        text NOT NULL,
  revealed_by text NOT NULL,
  revealed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, word)
);

-- A correct guess or the assassin ends a Codenames game and stores the winner.
ALTER TABLE codenames_games ADD COLUMN IF NOT EXISTS winner text;

CREATE INDEX IF NOT EXISTS idx_codenames_guesses_game_created ON codenames_guesses(game_id, created_at);
CREATE INDEX IF NOT EXISTS idx_codenames_revealed_game ON codenames_revealed(game_id);

-- ---------------------------------------------------------------------------
-- Gin Rummy (3019)
-- ---------------------------------------------------------------------------
-- winner_id exists in 0001 on fresh installs; keep older databases in step.
ALTER TABLE gin_rummy_games ADD COLUMN IF NOT EXISTS winner_id text;
-- A player must discard after drawing; false means the turn is ready to draw.
ALTER TABLE gin_rummy_games ADD COLUMN IF NOT EXISTS has_drawn boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_gin_rummy_games_status ON gin_rummy_games(status);
CREATE INDEX IF NOT EXISTS idx_gin_rummy_games_turn ON gin_rummy_games(status, current_turn);
