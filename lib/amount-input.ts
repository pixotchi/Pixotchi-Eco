import { parseUnits } from 'viem';

/** Exact input only: viem otherwise rounds excess fractional digits. */
export function parseAmountInput(value: string, decimals = 18): bigint | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const input = value.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(input)) return null;
  if ((input.split('.')[1]?.length ?? 0) > decimals) return null;
  try { return parseUnits(input, decimals); } catch { return null; }
}
