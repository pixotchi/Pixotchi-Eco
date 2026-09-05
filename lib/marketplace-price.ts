export type MarketplacePriceRatio = {
  leafAmount: bigint;
  seedAmount: bigint;
};

export type MarketplaceSellSide = 'LEAF' | 'SEED';

/** Exact identity and ordering: display rounding must never pick a trade. */
export function compareMarketplacePrices(a: MarketplacePriceRatio, b: MarketplacePriceRatio): number {
  const difference = a.leafAmount * b.seedAmount - b.leafAmount * a.seedAmount;
  return difference < BigInt(0) ? -1 : difference > BigInt(0) ? 1 : 0;
}

export function getMarketplaceRatioKey(ratio: MarketplacePriceRatio): string {
  let a = ratio.leafAmount;
  let b = ratio.seedAmount;
  while (b !== BigInt(0)) [a, b] = [b, a % b];
  return a > BigInt(0) ? `${ratio.leafAmount / a}/${ratio.seedAmount / a}` : '';
}

export function buildMarketplacePriceLevels(
  orders: readonly { amount: bigint; amountAsk: bigint; sellToken: number }[],
  sellToken: 0 | 1,
) {
  const levels = new Map<string, { key: string; exactRatio: MarketplacePriceRatio; amount: bigint }>();
  for (const order of orders) {
    if (order.sellToken !== sellToken) continue;
    const exactRatio = getMarketplacePriceRatio(order);
    if (!exactRatio) continue;
    const key = getMarketplaceRatioKey(exactRatio);
    const existing = levels.get(key);
    if (existing) existing.amount += order.amount;
    else levels.set(key, { key, exactRatio, amount: order.amount });
  }
  // Buying LEAF: maximize LEAF received per SEED. Buying SEED: minimize
  // LEAF paid per SEED. Both sides are ordered by the taker's benefit.
  const rows = [...levels.values()].sort((a, b) =>
    compareMarketplacePrices(a.exactRatio, b.exactRatio) * (sellToken === 1 ? -1 : 1),
  ).slice(0, 20);
  const total = rows.reduce((sum, row) => sum + row.amount, BigInt(0));
  let cumulative = BigInt(0);
  return rows.map(row => {
    cumulative += row.amount;
    return { ...row, depth: total ? Number(cumulative * BigInt(10_000) / total) / 100 : 0 };
  });
}

export function getMarketplacePriceRatio(order: {
  amount: bigint;
  amountAsk: bigint;
  sellToken: number;
}): MarketplacePriceRatio | null {
  const ratio = order.sellToken === 1
    ? { leafAmount: order.amount, seedAmount: order.amountAsk }
    : { leafAmount: order.amountAsk, seedAmount: order.amount };
  return ratio.leafAmount > BigInt(0) && ratio.seedAmount > BigInt(0) ? ratio : null;
}

export function formatMarketplacePriceRatio(
  ratio: MarketplacePriceRatio,
  decimals = 18,
): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return '';
  if (ratio.leafAmount <= BigInt(0) || ratio.seedAmount <= BigInt(0)) return '';

  const scale = BigInt(10) ** BigInt(decimals);
  const scaled = (ratio.leafAmount * scale) / ratio.seedAmount;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function computeMarketplaceAmountAsk(
  sellSide: MarketplaceSellSide,
  sellAmount: bigint,
  ratio: MarketplacePriceRatio,
): bigint | null {
  if (
    sellAmount <= BigInt(0)
    || ratio.leafAmount <= BigInt(0)
    || ratio.seedAmount <= BigInt(0)
  ) return null;

  const amountAsk = sellSide === 'SEED'
    ? (sellAmount * ratio.leafAmount) / ratio.seedAmount
    : (sellAmount * ratio.seedAmount) / ratio.leafAmount;
  return amountAsk > BigInt(0) ? amountAsk : null;
}
