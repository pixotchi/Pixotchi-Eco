import { formatTokenDisplay, formatTokenDisplayCompact, formatTokenEstimate } from '@/lib/token-display';
import { cn } from '@/lib/utils';
import { ResourceValue } from './resource-value';

/** Compact visual amounts retain the exact quantity for inspection and speech. */
export function TokenAmount({ amount, unit, decimals = 18, mode = 'summary', precision = 2, className, withIcon = true }: {
  amount: bigint; unit: string; decimals?: number; mode?: 'summary' | 'compact' | 'exact' | 'estimate'; precision?: number; className?: string;
  withIcon?: boolean;
}) {
  const exact = `${formatTokenDisplay(amount, decimals, decimals)} ${unit}`;
  const visible = mode === 'compact' ? formatTokenDisplayCompact(amount, decimals)
    : mode === 'estimate' ? formatTokenEstimate(amount, decimals, precision)
    : formatTokenDisplay(amount, decimals, mode === 'exact' ? decimals : precision);
  const value = <>{visible} {unit}</>;
  return <span className={cn('tabular-nums [overflow-wrap:anywhere]', className)} title={exact} aria-label={`${exact}${mode === 'estimate' ? ' estimated' : ''}`}>{withIcon ? <ResourceValue unit={unit}>{value}</ResourceValue> : value}</span>;
}
