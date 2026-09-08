"use client";

import { Button } from '@/components/ui/button';
import { ResourceState } from '@/components/ui/resource-state';
import type { BuildingPurchaseReadiness } from '@/lib/building-purchase-readiness';

export function PurchaseReadinessNotice({ state, symbol, cost, balance, formatAmount, onRetryBalance, onRetryAllowance }: {
  state: BuildingPurchaseReadiness; symbol?: string; cost: bigint; balance?: bigint;
  formatAmount: (amount: bigint) => string;
  onRetryBalance: () => void; onRetryAllowance: () => void;
}) {
  if (state === 'insufficient' && balance !== undefined) return (
    <div className="space-y-2 text-sm [overflow-wrap:anywhere]">
      <Button className="h-auto w-full whitespace-normal leading-snug" variant="secondary" disabled>Insufficient {symbol} balance</Button>
      <p className="text-muted-foreground">You need {formatAmount(cost - balance)} more {symbol}. Required: {formatAmount(cost)}. Available: {formatAmount(balance)}.</p>
      <Button className="h-auto max-w-full whitespace-normal leading-snug" variant="outline" onClick={onRetryBalance}>Refresh balance</Button>
    </div>
  );
  const isBalance = state === 'checking_balance' || state === 'balance_error';
  const isError = state === 'balance_error' || state === 'allowance_error';
  return <ResourceState status={isError ? 'error' : 'loading'}
    title={isError ? `${isBalance ? 'Balance' : 'Approval status'} unavailable` : `Checking ${isBalance ? 'balance' : 'approval status'}…`}
    description={isError ? 'Try the check again before continuing.' : undefined}
    onRetry={isBalance ? onRetryBalance : onRetryAllowance} />;
}
