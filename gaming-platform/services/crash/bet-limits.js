/** Shared per-round stake guard.
 *
 * Manual bets checked the operator's per-player `maxBet` before calling
 * `reserveBet`, while auto sessions called `reserveBet` directly and were only
 * compared with the global `MAX_BET`. With two auto panels this allowed stakes
 * above an operator-configured limit. Keep the comparison in one small helper
 * so both callers and the reservation transaction use the same rule.
 */
export function combinedStakeExceeded(otherPanelStake, amount, maxBet) {
  const committed = Number(otherPanelStake ?? 0);
  const stake = Number(amount);
  const ceiling = Number(maxBet);
  if (!Number.isFinite(committed) || !Number.isFinite(stake) || !Number.isFinite(ceiling)) return true;
  return committed + stake > ceiling;
}
