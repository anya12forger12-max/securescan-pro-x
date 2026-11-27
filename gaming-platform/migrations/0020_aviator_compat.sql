-- Aviator protocol compatibility (migration 0020).
--
-- Repeating a money-affecting request must return the first response even
-- when the HTTP reply was lost. The wallet already dedupes by key; this table
-- remembers the *public* result so a client retry is not reported as a fresh
-- conflict. Kind is part of the key so one reqId may be reused for a bet and
-- a later cash-out without collision.
CREATE TABLE IF NOT EXISTS crash_requests (
  user_id     text NOT NULL,
  req_id      text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('bet','cashout')),
  status      integer NOT NULL,
  body        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, req_id, kind)
);
-- Bet cancellation is also money-affecting (it refunds the stake), so its
-- reqId gets the same replay protection. Re-declare the check so deployments
-- that already ran an earlier revision of this migration pick up the new kind.
ALTER TABLE crash_requests DROP CONSTRAINT IF EXISTS crash_requests_kind_check;
ALTER TABLE crash_requests ADD CONSTRAINT crash_requests_kind_check
  CHECK (kind IN ('bet','cashout','cancel'));
CREATE INDEX IF NOT EXISTS idx_crash_requests_created
  ON crash_requests (created_at);

-- Auto-bet sessions record why they stopped so clients can explain the stop
-- instead of silently going quiet (balanceBelow is enforced in the engine).
ALTER TABLE crash_auto_sessions
  ADD COLUMN IF NOT EXISTS stop_reason text;
