/** Shared terminal failures only; submitted, unresolved and syncing proofs stay pending. */
const GAME_TRANSACTION_FAILURES: ReadonlySet<string> = new Set([
  "error", "failed", "reverted", "superseded", "cancelled", "canceled", "rejected",
  "transactionRejected", "userRejected", "buildError",
]);

export function isGameTransactionFailure(statusName: string): boolean {
  return GAME_TRANSACTION_FAILURES.has(statusName);
}
