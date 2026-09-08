export type BuildingPurchaseReadiness =
  | 'checking_balance' | 'balance_error' | 'insufficient'
  | 'checking_allowance' | 'allowance_error' | 'approval_required' | 'ready';

/** A failed or missing read is never a zero balance or permission. Affordability comes first. */
export function getBuildingPurchaseReadiness({ cost, balance, allowance, balanceError, allowanceError }: {
  cost: bigint; balance?: bigint; allowance?: bigint; balanceError?: unknown; allowanceError?: unknown;
}): BuildingPurchaseReadiness {
  if (cost === BigInt(0)) return 'ready';
  if (balanceError) return 'balance_error';
  if (balance === undefined) return 'checking_balance';
  if (balance < cost) return 'insufficient';
  if (allowanceError) return 'allowance_error';
  if (allowance === undefined) return 'checking_allowance';
  return allowance < cost ? 'approval_required' : 'ready';
}
