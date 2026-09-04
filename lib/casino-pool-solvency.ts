/**
 * Conservative client-side caps for games whose reward pool pays the winning
 * return. These values intentionally include the wager principal and round up
 * the highest configured payout so a stale/optimistic UI cannot offer a stake
 * that the pool cannot cover.
 */
export const ROULETTE_WORST_CASE_RETURN_FACTOR = BigInt(36); // 35:1 + returned stake
export const BACCARAT_WORST_CASE_RETURN_FACTOR = BigInt(10); // Tie is conservatively rounded above the 9:1 UI payout

export function getPoolBoundedMaxBet(
  configuredMaxBet: bigint,
  poolBalance: bigint | null,
  worstCaseReturnFactor: bigint,
): bigint | null {
  if (poolBalance === null) return null;
  if (configuredMaxBet <= BigInt(0) || poolBalance <= BigInt(0) || worstCaseReturnFactor <= BigInt(0)) {
    return BigInt(0);
  }

  const poolMaxBet = poolBalance / worstCaseReturnFactor;
  return configuredMaxBet < poolMaxBet ? configuredMaxBet : poolMaxBet;
}

/**
 * Maximum additional stake that can be added while conservatively covering
 * the already selected bets and the candidate's worst-case return.
 */
export function getPoolBoundedAdditionalBet(
  poolBalance: bigint | null,
  existingWorstCasePayout: bigint,
  candidateReturnFactor: bigint,
): bigint | null {
  if (poolBalance === null) return null;
  if (candidateReturnFactor <= BigInt(0) || poolBalance <= existingWorstCasePayout) return BigInt(0);
  return (poolBalance - existingWorstCasePayout) / candidateReturnFactor;
}
