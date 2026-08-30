export type MarketplacePriceRatio = {
  leafAmount: bigint;
  seedAmount: bigint;
};

export type MarketplaceSellSide = 'LEAF' | 'SEED';

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
