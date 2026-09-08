import type { Hex } from 'viem';

/** Public receipt identity only; reveal secrets never belong in result recovery. */
export type SpinResultRecovery = { account: string; plantId: number; transactionHash: Hex | null };
const key = (account: string, plantId: number) => `pixotchi:spinleaf:result:${account.toLowerCase()}:${plantId}`;

export function readSpinResultRecovery(account: string, plantId: number): SpinResultRecovery | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(account, plantId)) ?? 'null');
    return value && value.account === account.toLowerCase() && value.plantId === plantId &&
      (value.transactionHash === null || /^0x[0-9a-f]{64}$/i.test(value.transactionHash)) ? value : null;
  } catch { return null; }
}

export function storeSpinResultRecovery(value: SpinResultRecovery): void {
  try { localStorage.setItem(key(value.account, value.plantId), JSON.stringify({ ...value, account: value.account.toLowerCase() })); } catch { /* Receipt remains visible for this session. */ }
}

export function clearSpinResultRecovery(account: string, plantId: number, expectedHash?: Hex | null): void {
  try {
    if (expectedHash !== undefined && readSpinResultRecovery(account, plantId)?.transactionHash !== expectedHash) return;
    localStorage.removeItem(key(account, plantId));
  } catch { /* Optional public receipt cache. */ }
}

export function formatSignedSpinValue(value: number, format: (magnitude: number) => string): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${format(Math.abs(value))}`;
}
