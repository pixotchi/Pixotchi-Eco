import { BASIS_POINTS, MARKET_SLIPPAGE_BPS, SEED_TAX_BPS } from './constants';

export type SeedPurchaseQuote = {
  seedAmount: bigint;
  ethAmount: bigint;
  ethAmountWithBuffer: bigint;
  error?: string;
};

const ceilDivide = (value: bigint, divisor: bigint) => (value + divisor - BigInt(1)) / divisor;

/** Quote the complete net SEED payment, including transfer tax and pool impact. */
export async function quoteSeedPurchase(
  seedAmount: bigint,
  readAmountsIn: (grossSeedAmount: bigint) => Promise<readonly bigint[]>,
): Promise<SeedPurchaseQuote> {
  if (seedAmount <= BigInt(0)) throw new Error('Invalid amount');
  const basis = BigInt(BASIS_POINTS);
  const grossSeedAmount = ceilDivide(seedAmount * basis, basis - BigInt(SEED_TAX_BPS));
  const amounts = await readAmountsIn(grossSeedAmount);
  if (amounts.length < 2 || amounts[0] <= BigInt(0) || amounts[1] < grossSeedAmount) {
    throw new Error('No liquidity available');
  }

  return {
    seedAmount,
    ethAmount: amounts[0],
    ethAmountWithBuffer: ceilDivide(amounts[0] * (basis + BigInt(MARKET_SLIPPAGE_BPS)), basis),
  };
}
