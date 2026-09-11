import { formatTokenDisplay, formatTokenSymbol } from './token-display';

/** Use raw units so shortfalls remain exact, including very small gas amounts. */
export function getBalanceShortfallMessage(
  balance: bigint,
  required: bigint,
  symbol: string,
  decimals = 18,
): string | null {
  if (balance >= required) return null;
  const token = formatTokenSymbol(symbol) ?? symbol;
  if (balance === BigInt(0)) {
    return `You need ${formatTokenDisplay(required, decimals, decimals)} ${token}.`;
  }
  return `Not enough ${token}. You need ${formatTokenDisplay(required - balance, decimals, decimals)} more.`;
}
