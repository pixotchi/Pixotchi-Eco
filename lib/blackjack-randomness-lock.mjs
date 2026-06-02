export function normalizeBlackjackLockBetAmount(action, betAmountWei) {
  if (action !== 'deal') return null;
  if (typeof betAmountWei !== 'string' || !/^\d+$/.test(betAmountWei)) return null;
  return betAmountWei;
}

export function blackjackRandomnessLockMismatch(
  cached,
  actionNum,
  handIndexNum,
  bettingToken,
  playerAddress,
  betAmountWei,
) {
  return (
    cached.actionNum !== actionNum ||
    cached.handIndex !== handIndexNum ||
    cached.bettingToken.toLowerCase() !== bettingToken.toLowerCase() ||
    cached.playerAddress.toLowerCase() !== playerAddress.toLowerCase() ||
    (cached.betAmountWei ?? null) !== (betAmountWei ?? null)
  );
}
