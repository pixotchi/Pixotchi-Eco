import type { SwapQuoteResponse } from './types';
import { SwapReviewRequiredError } from './errors';

/** The player's review includes financial terms, not transport tokens/timestamps. */
export function getSwapReviewIdentity(quote: SwapQuoteResponse): string {
  return JSON.stringify([quote.strategy, quote.sellToken, quote.buyToken, quote.amountIn,
    quote.expectedOut, quote.minOut, quote.marketSlippageBps, quote.taxBps]);
}

export function requireUnchangedSwapReview(reviewed: SwapQuoteResponse, refreshed: SwapQuoteResponse): void {
  if (reviewed.strategy !== 'single_kyber' || refreshed.strategy !== 'single_kyber'
    || reviewed.sellToken !== refreshed.sellToken || reviewed.buyToken !== refreshed.buyToken
    || reviewed.amountIn !== refreshed.amountIn || reviewed.taxBps !== refreshed.taxBps
    || reviewed.marketSlippageBps !== refreshed.marketSlippageBps
    || BigInt(refreshed.minOut) < BigInt(reviewed.minOut)) {
    throw new SwapReviewRequiredError();
  }
}

export type LastSwapTransaction = { owner: string; hash: `0x${string}`; action: 'approval' | 'swap'; confirmedAt: number };

export function parseLastSwapTransaction(value: string | null, owner: string | undefined): LastSwapTransaction | null {
  if (!value || !owner) return null;
  try {
    const record: unknown = JSON.parse(value);
    if (!record || typeof record !== 'object') return null;
    const fields = record as Record<string, unknown>;
    if (fields.owner !== owner.toLowerCase() || typeof fields.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(fields.hash)
      || (fields.action !== 'approval' && fields.action !== 'swap') || typeof fields.confirmedAt !== 'number' || !Number.isFinite(fields.confirmedAt)) return null;
    return { owner: fields.owner, hash: fields.hash as `0x${string}`, action: fields.action, confirmedAt: fields.confirmedAt };
  } catch { return null; }
}
