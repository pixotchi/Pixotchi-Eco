import type { SwapQuoteResponse } from './types';

/** Preview fees belong to a wallet/draft/route, not a rotating quote credential.
 * Price output and timestamps may refresh without replacing the cached budget.
 * Exact calldata and available funds are still checked before each wallet call.
 */
export function swapFeeQueryKey(address: string | undefined, chainId: number | undefined, quote: SwapQuoteResponse | null) {
  const step = quote?.steps[0];
  return ['swapFee', address?.toLowerCase() ?? null, chainId ?? null, quote && step ? {
    strategy: quote.strategy,
    sellToken: quote.sellToken,
    buyToken: quote.buyToken,
    amountIn: quote.amountIn,
    step: {
      kind: step.kind, sellToken: step.sellToken, buyToken: step.buyToken,
      amountIn: step.amountIn, approvalTarget: step.approvalTarget?.toLowerCase() ?? null,
      taxBps: step.taxBps, marketSlippageBps: step.marketSlippageBps,
      routeSources: step.routeSources,
    },
  } : null] as const;
}
