import { BASIS_POINTS } from './constants';
import { SwapReviewRequiredError } from './errors';

export function requiredSwapMinimum(reviewed: bigint, fresh: bigint): bigint {
  if (reviewed <= BigInt(0) || fresh <= BigInt(0)) throw new SwapReviewRequiredError();
  return reviewed > fresh ? reviewed : fresh;
}

/** Round tolerance down, so rounding can only strengthen the integer floor. */
export function getProtectedBuildSlippageBps(grossOut: bigint, minimum: bigint): number {
  if (grossOut <= BigInt(0) || minimum <= BigInt(0) || minimum > grossOut) {
    throw new SwapReviewRequiredError();
  }
  return Number(((grossOut - minimum) * BigInt(BASIS_POINTS)) / grossOut);
}
