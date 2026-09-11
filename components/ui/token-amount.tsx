'use client';
import { RollingNumber } from './rolling-number';
import { formatTokenCost, formatTokenDisplay, formatTokenDisplayCompact, formatTokenEstimate, formatTokenSymbol } from '@/lib/token-display';
import { cn } from '@/lib/utils';
import { ResourceValue } from './resource-value';

/** Display amounts as text, retaining full precision for speech and hover. */
export function TokenAmount({ amount, unit, decimals = 18, mode = 'summary', precision = 2, className, withIcon = true, animated = false }: {
  amount: bigint; unit: string; decimals?: number; mode?: 'summary' | 'compact' | 'exact' | 'estimate' | 'cost'; precision?: number; className?: string;
  animated?: boolean;
  withIcon?: boolean;
}) {
  const displayUnit = formatTokenSymbol(unit) ?? unit;
  const exact = `${formatTokenDisplay(amount, decimals, decimals)} ${displayUnit}`;
  const visible = mode === 'compact' ? formatTokenDisplayCompact(amount, decimals)
    : mode === 'estimate' ? formatTokenEstimate(amount, decimals, precision)
    : mode === 'cost' ? formatTokenCost(amount, decimals, precision)
    : formatTokenDisplay(amount, decimals, mode === 'exact' ? decimals : precision);
  const value = <>{animated ? <RollingNumber value={visible} /> : visible} {displayUnit}</>;
  const content = withIcon ? <ResourceValue unit={displayUnit}>{value}</ResourceValue> : value;
  return <span className={cn('type-numeric [overflow-wrap:anywhere]', className)} title={exact} aria-label={`${exact}${mode === 'estimate' ? ' estimated' : ''}`}>
    {content}
  </span>;
}
