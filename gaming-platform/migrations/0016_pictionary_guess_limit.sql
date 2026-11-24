-- Guess allowance checks count a player's incorrect guesses for one round.
-- The existing (round_id, created_at) index cannot narrow by user or outcome.
CREATE INDEX IF NOT EXISTS idx_pictionary_guesses_player_wrong
  ON pictionary_guesses(round_id, user_id) WHERE correct = false;
