-- Add an explicit in-flight state for stake refunds. A duplicate or ambiguous
-- bet activation must claim the refund atomically before any wallet credit;
-- without this state the credit could land while the bet was still live, or a
-- payout and a refund could both settle the same stake under different keys.
ALTER TABLE crash_bets
  DROP CONSTRAINT IF EXISTS crash_bets_status_check;
ALTER TABLE crash_bets
  ADD CONSTRAINT crash_bets_status_check
    CHECK (status IN ('pending','active','refunding','cashing_out','cashed_out',
                      'lost','cancelled','refunded'));
