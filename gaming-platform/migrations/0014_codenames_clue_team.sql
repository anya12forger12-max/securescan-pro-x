-- Bind every guess allowance to the team whose spymaster gave the clue.
-- Historical clues have no recorded team; they are treated as no valid clue
-- until a new team-scoped clue is submitted, which is safer than letting an
-- opponent spend an old allowance after a turn flip.
ALTER TABLE codenames_clues
  ADD COLUMN IF NOT EXISTS team text;
ALTER TABLE codenames_clues
  DROP CONSTRAINT IF EXISTS codenames_clues_team_check;
ALTER TABLE codenames_clues
  ADD CONSTRAINT codenames_clues_team_check
    CHECK (team IS NULL OR team IN ('red','blue'));

ALTER TABLE codenames_guesses
  ADD COLUMN IF NOT EXISTS clue_id uuid REFERENCES codenames_clues(id) ON DELETE SET NULL;
