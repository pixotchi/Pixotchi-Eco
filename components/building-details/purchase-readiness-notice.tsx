"use client";
import { getBalanceShortfallMessage } from '@/lib/balance-shortfall';

import { InlineBalanceNotice } from '@/components/ui/premium';
import { ResourceState } from '@/components/ui/resource-state';
import { formatTokenSymbol } from '@/lib/token-display';
import type { BuildingPurchaseReadiness } from '@/lib/building-purchase-readiness';

export function PurchaseReadinessNotice({ state, symbol, cost, balance, decimals, onRetryBalance, onRetryAllowance }: {
  state: BuildingPurchaseReadiness; symbol?: string; cost: bigint; balance?: bigint; decimals?: number;
  onRetryBalance: () => void; onRetryAllowance: () => void;
}) {
  if (state === 'insufficient' && balance !== undefined) return (
    <InlineBalanceNotice>
      {decimals !== undefined && symbol
        ? getBalanceShortfallMessage(balance, cost, symbol, decimals)
        : `Not enough ${formatTokenSymbol(symbol) ?? 'tokens'}.`}
    </InlineBalanceNotice>
  );
  const isBalance = state === 'checking_balance' || state === 'balance_error';
  const isError = state === 'balance_error' || state === 'allowance_error';
  return <ResourceState status={isError ? 'error' : 'loading'}
    title={isError ? `${isBalance ? 'Balance' : 'Approval status'} unavailable` : `Checking ${isBalance ? 'balance' : 'approval status'}…`}
    description={isError ? 'Try the check again before continuing.' : undefined}
    onRetry={isBalance ? onRetryBalance : onRetryAllowance} />;
}
