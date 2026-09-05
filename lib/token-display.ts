import { parseAmountInput } from './amount-input';

/** Read-only balances truncate; editable amounts must continue to use exact units. */
export function formatTokenDisplay(amount: bigint, decimals = 18, precision = 2): string {
  const digits = Math.max(0, Math.min(decimals, precision));
  const scale = BigInt(10) ** BigInt(decimals);
  const absolute = amount < BigInt(0) ? -amount : amount;
  const sign = amount < BigInt(0) ? '-' : '';
  const fraction = (absolute % scale).toString().padStart(decimals, '0').slice(0, digits).replace(/0+$/, '');
  if (absolute > BigInt(0) && absolute < BigInt(10) ** BigInt(decimals - digits)) {
    return `${sign}<${digits ? `0.${'0'.repeat(digits - 1)}1` : '1'}`;
  }
  const whole = (absolute / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function formatTokenDisplayCompact(amount: bigint, decimals = 18): string {
  const absolute = amount < BigInt(0) ? -amount : amount;
  for (const [power, suffix] of [[12, 'T'], [9, 'B'], [6, 'M'], [3, 'K']] as const) {
    if (absolute >= BigInt(10) ** BigInt(decimals + power)) {
      return `${formatTokenDisplay(amount, decimals + power, 2)}${suffix}`;
    }
  }
  return formatTokenDisplay(amount, decimals);
}

/** Quotes are explicitly approximate; even sub-precision costs remain nonzero. */
export function formatTokenEstimate(amount: bigint, decimals = 18, precision = 6): string {
  return `~${formatTokenDisplay(amount, decimals, precision)}`;
}

/** Decimal API/result strings share the same policy and never pass through Number. */
export function formatTokenDecimal(value: string, decimals = 18, mode: 'summary' | 'compact' | 'exact' = 'summary'): string | null {
  const amount = parseAmountInput(value, decimals);
  if (amount === null) return null;
  return mode === 'compact' ? formatTokenDisplayCompact(amount, decimals) : formatTokenDisplay(amount, decimals, mode === 'exact' ? decimals : 2);
}
