-- Migration 0011 neutralised every historical gin-rummy 'concession' because
-- 0010 had already labelled unverifiable old wins as concessions and the
-- original distinction was never written down. That data cannot be recovered
-- retroactively, so historical rows stay 'completed' (no leaderboard points).
--
-- Going forward the authoritative outcome is appended here inside the same
-- transaction that ends the game. A later backfill can never silently rewrite
-- an explicit concession: this table is the durable evidence of what happened.
CREATE TABLE IF NOT EXISTS gin_rummy_outcomes (
  game_id     uuid PRIMARY KEY REFERENCES gin_rummy_games(id) ON DELETE CASCADE,
  win_type    text NOT NULL CHECK (win_type IN ('validated', 'concession', 'completed')),
  source      text NOT NULL CHECK (source IN ('meld', 'end', 'backfill')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- Preserve the current state of every existing game. Rows already labelled
-- 'validated' remain validated; neutral rows are explicitly recorded as such
-- so a future reader can tell "we knew it was neutral" from "no row exists".
INSERT INTO gin_rummy_outcomes (game_id, win_type, source)
SELECT g.id, g.win_type, 'backfill'
  FROM gin_rummy_games g
  LEFT JOIN gin_rummy_outcomes o ON o.game_id = g.id
 WHERE o.game_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_gin_rummy_outcomes_recorded_at
  ON gin_rummy_outcomes (recorded_at DESC);
