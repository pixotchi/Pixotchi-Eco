export type ReviveRead = { balance: bigint; price: bigint };

export async function readReviveReadiness(
  owner: string,
  readBalance: (owner: string) => Promise<bigint>,
  readPrice: () => Promise<bigint>,
): Promise<ReviveRead> {
  const [balance, price] = await Promise.all([readBalance(owner), readPrice()]);
  if (typeof balance !== 'bigint' || balance < BigInt(0) || typeof price !== 'bigint' || price < BigInt(0)) {
    throw new Error('Revive cost or SEED balance is unavailable. Try again.');
  }
  return { balance, price };
}

export function assertReviveReadiness(current: ReviveRead, reviewedPrice: bigint) {
  if (current.price !== reviewedPrice) throw new Error('The revive cost changed. Review the updated cost and try again.');
  if (current.balance < current.price) throw new Error('Not enough SEED to revive this plant.');
}

export function assertKillReadiness(cooldown: { canKill: boolean; remainingSeconds: number }) {
  if (!cooldown.canKill || cooldown.remainingSeconds > 0) {
    throw new Error('Collecting a star is still on cooldown. Wait for the timer to finish.');
  }
}
