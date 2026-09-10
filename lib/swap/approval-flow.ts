import { SWAP_QUOTE_MAX_AGE_MS } from './constants';
import { SwapReviewRequiredError } from './errors';
import { requireUnchangedSwapReview } from './review';
import type { SwapApprovalRequirement, SwapBuildStepResponse, SwapQuoteResponse } from './types';

/** The direct-wallet controller must finish approval before preparing its final swap. */
export async function approveAndRebuildSwap({ reviewed, built, approve, refresh, build, now = Date.now }: {
  reviewed: SwapQuoteResponse;
  built: SwapBuildStepResponse;
  approve: (approval: SwapApprovalRequirement) => Promise<void>;
  refresh: () => Promise<SwapQuoteResponse | null>;
  build: (quote: SwapQuoteResponse) => Promise<SwapBuildStepResponse>;
  now?: () => number;
}): Promise<SwapBuildStepResponse> {
  const approval = built.approval;
  if (!approval) return built;
  await approve(approval);

  let quote = reviewed;
  const timestamp = now();
  if (!quote.issuedAt || !quote.expiresAt || timestamp >= quote.expiresAt
    || timestamp - quote.issuedAt > SWAP_QUOTE_MAX_AGE_MS) {
    const refreshed = await refresh();
    if (!refreshed) throw new SwapReviewRequiredError();
    requireUnchangedSwapReview(reviewed, refreshed);
    quote = refreshed;
  }
  if (!quote.quoteToken) throw new SwapReviewRequiredError();
  const next = await build(quote);
  if (!next.approval || next.approval.token.toLowerCase() !== approval.token.toLowerCase()
    || next.approval.spender.toLowerCase() !== approval.spender.toLowerCase()
    || next.approval.requiredAmount !== approval.requiredAmount
    || BigInt(next.step.minOut) < BigInt(reviewed.minOut)) throw new SwapReviewRequiredError();
  return next;
}
