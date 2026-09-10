import { maxUint256 } from 'viem';

/** API amounts are decimal strings; absent or malformed amounts stay unknown. */
export function parseStakingAllowance(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const allowance = BigInt(value);
  return allowance <= maxUint256 ? allowance : null;
}

export function getStakingAllowanceReadiness(allowance: bigint | null, amount: bigint | null) {
  if (allowance === null) return 'unknown' as const;
  if (amount === null || amount <= BigInt(0)) return 'invalid_amount' as const;
  return allowance < amount ? 'needs_approval' as const : 'ready' as const;
}

/** Re-read the exact allowance before handing a stake to the wallet. */
export async function requireStakingAllowance({ amount, read, isCurrent, onRead }: {
  amount: bigint;
  read: () => Promise<bigint>;
  isCurrent: () => boolean;
  onRead: (allowance: bigint | null) => void;
}): Promise<void> {
  const requireCurrent = () => {
    if (!isCurrent()) throw new Error('Your wallet or stake amount changed. Review the stake again.');
  };
  requireCurrent();
  if (amount <= BigInt(0)) throw new Error('Enter a valid stake amount.');
  let allowance: bigint;
  try {
    allowance = await read();
    if (typeof allowance !== 'bigint' || allowance < BigInt(0) || allowance > maxUint256) {
      throw new Error('Invalid allowance');
    }
  } catch {
    requireCurrent();
    onRead(null);
    throw new Error('Could not verify the SEED allowance. Retry the staking data before staking.');
  }
  requireCurrent();
  onRead(allowance);
  if (allowance < amount) throw new Error('Approve enough SEED for this amount before staking.');
}
