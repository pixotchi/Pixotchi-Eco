import { formatTokenCost, formatTokenSymbol } from './token-display';

/** Calculate in raw units, then round up for a readable funding target. */
export function getBalanceShortfallMessage(
  balance: bigint,
  required: bigint,
  symbol: string,
  decimals = 18,
): string | null {
  if (balance >= required) return null;
  const token = formatTokenSymbol(symbol) ?? symbol;
  const precision = ['ETH', 'SOL', 'WSOL'].includes(token) ? 6 : 2;
  const amount = formatTokenCost(required - balance, decimals, precision)
    .replace(/^</, 'less than ');
  if (balance === BigInt(0)) {
    return `You need ${amount} ${token}.`;
  }
  return `Not enough ${token}. You need ${amount} more.`;
}
