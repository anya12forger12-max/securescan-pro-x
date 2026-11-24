-- Indexes for read paths that became hot after the gameplay/realtime work.
-- All are additive and safe to apply to a live database.

-- Codenames clue allowance is counted once per clue on every guess.
CREATE INDEX IF NOT EXISTS idx_codenames_guesses_clue
  ON codenames_guesses(clue_id);

-- Realtime retention pruning deletes by published_at on a timer.
CREATE INDEX IF NOT EXISTS idx_realtime_events_published_at
  ON realtime_events(published_at);

-- Leaderboard verification resolves results by their originating session.
CREATE INDEX IF NOT EXISTS idx_gin_rummy_games_session
  ON gin_rummy_games(session_id);
CREATE INDEX IF NOT EXISTS idx_codenames_games_session
  ON codenames_games(session_id);
CREATE INDEX IF NOT EXISTS idx_pictionary_rounds_session
  ON pictionary_rounds(session_id);
