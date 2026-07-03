export const BACCARAT_BET_TYPE = Object.freeze({
  PLAYER: 0,
  BANKER: 1,
  TIE: 2,
});

export const BACCARAT_OUTCOME = Object.freeze({
  PLAYER: 0,
  BANKER: 1,
  TIE: 2,
});

export function baccaratCardValue(card) {
  const rank = (Number(card) % 13) + 1;
  if (rank >= 10) return 0;
  return rank;
}

export function baccaratHandTotal(cards) {
  return cards.reduce((sum, card) => sum + baccaratCardValue(card), 0) % 10;
}

export function baccaratBankerShouldDraw(bankerTotal, playerThirdValue) {
  if (bankerTotal <= 2) return true;
  if (bankerTotal === 3) return playerThirdValue !== 8;
  if (bankerTotal === 4) return playerThirdValue >= 2 && playerThirdValue <= 7;
  if (bankerTotal === 5) return playerThirdValue >= 4 && playerThirdValue <= 7;
  if (bankerTotal === 6) return playerThirdValue === 6 || playerThirdValue === 7;
  return false;
}

export function baccaratCalculatePayoutWei(
  betType,
  outcome,
  amountWei,
  bankerCommissionBps = 500,
  tiePayoutMultiplier = 8,
) {
  const amount = BigInt(amountWei);

  if (outcome === BACCARAT_OUTCOME.TIE) {
    if (betType === BACCARAT_BET_TYPE.TIE) {
      return { won: true, payoutWei: amount + (amount * BigInt(tiePayoutMultiplier)) };
    }
    return { won: false, payoutWei: amount };
  }

  if (outcome === BACCARAT_OUTCOME.PLAYER && betType === BACCARAT_BET_TYPE.PLAYER) {
    return { won: true, payoutWei: amount * 2n };
  }

  if (outcome === BACCARAT_OUTCOME.BANKER && betType === BACCARAT_BET_TYPE.BANKER) {
    const profit = amount * BigInt(10_000 - bankerCommissionBps) / 10_000n;
    return { won: true, payoutWei: amount + profit };
  }

  return { won: false, payoutWei: 0n };
}
