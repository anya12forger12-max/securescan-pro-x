-- 0010 labelled every historical gin-rummy win as 'concession' because the
-- older schema recorded no meld/concession log. That mislabels ordinary wins.
-- Neither a concession nor an unverifiable historical win earns leaderboard
-- points, so use a neutral 'completed' value for both. New games with no
-- explicit /meld result keep that neutral default; /end still writes the
-- explicit 'concession' value and /meld still writes 'validated'.
-- This is a new migration rather than an edit to 0010: applied migrations are
-- checksummed, so rewriting 0010 would break upgrades of existing volumes.
ALTER TABLE gin_rummy_games
  ADD COLUMN IF NOT EXISTS win_type text NOT NULL DEFAULT 'completed';
UPDATE gin_rummy_games
  SET win_type = 'completed'
  WHERE win_type IS NULL OR win_type = 'concession';
ALTER TABLE gin_rummy_games ALTER COLUMN win_type SET DEFAULT 'completed';
ALTER TABLE gin_rummy_games ALTER COLUMN win_type SET NOT NULL;
ALTER TABLE gin_rummy_games
  DROP CONSTRAINT IF EXISTS gin_rummy_games_win_type_check;
ALTER TABLE gin_rummy_games
  ADD CONSTRAINT gin_rummy_games_win_type_check
    CHECK (win_type IN ('validated', 'concession', 'completed'));
