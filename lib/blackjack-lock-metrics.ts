const counts = { quarantined_nonces: 0, issuance_quarantined: 0, inventory_required: 0, invalid_record: 0, unavailable: 0 };
export type BlackjackLockCounter = keyof typeof counts;

/** Fixed labels and saturating process-local counters; never accepts a wallet, key, seed or signature. */
export function incrementBlackjackLockCounter(name: BlackjackLockCounter): void {
  counts[name] = Math.min(Number.MAX_SAFE_INTEGER, counts[name] + 1);
}

export function getBlackjackLockCounters(): Readonly<typeof counts> {
  return { ...counts };
}
