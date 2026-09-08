import type { ReactNode } from 'react';
import { TokenAmount } from '@/components/ui/token-amount';
import { SWAP_TOKEN_MAP } from '@/lib/swap/constants';
import type { SwapQuoteResponse } from '@/lib/swap/types';

export function SwapQuoteReview({ quote, fee }: { quote: SwapQuoteResponse; fee?: ReactNode }) {
  if (quote.strategy === 'blocked') return null;
  const token = SWAP_TOKEN_MAP[quote.buyToken];
  return <div aria-label="Swap quote review" className="mt-3 space-y-2 rounded-[var(--radius-control)] border border-border/60 bg-background/40 p-3 text-xs text-muted-foreground">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="shrink-0">Minimum received</span>
      <TokenAmount amount={BigInt(quote.minOut)} unit={token.displaySymbol} decimals={token.decimals} mode="exact" withIcon={false} className="min-w-0 text-right font-semibold text-foreground" />
    </div>
    <div className="flex items-center justify-between gap-3"><span>Token tax</span><span>{(quote.taxBps / 100).toFixed(2)}%</span></div>
    {fee}
    <details>
      <summary className="cursor-pointer py-1 font-medium text-foreground">Route and slippage</summary>
      <div className="space-y-1 pt-1">
        <p className="[overflow-wrap:anywhere]">{quote.steps.map(step => step.routeLabel).filter(Boolean).join(' → ') || 'Direct route'}</p>
        <p>Slippage tolerance: {(quote.marketSlippageBps / 100).toFixed(2)}%</p>
      </div>
    </details>
  </div>;
}
