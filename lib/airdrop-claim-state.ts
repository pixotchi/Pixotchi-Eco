export type AirdropClaimRecordStatus = 'eligible' | 'pending' | 'claimed' | 'failed';

export type AirdropEligibilityRecord = {
  seed?: string;
  leaf?: string;
  pixotchi?: string;
  claimed?: boolean;
  claimedAt?: number;
  txHash?: string | null;
  status?: AirdropClaimRecordStatus;
  attemptId?: string;
  operationId?: string;
  reservedAt?: number;
  reservationExpiresAt?: number;
  failedAt?: number;
  failureReason?: string;
};

export function parseAirdropEligibility(raw: UntypedValue): AirdropEligibilityRecord | null {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object'
      ? parsed as AirdropEligibilityRecord
      : null;
  } catch {
    return null;
  }
}

export function getAirdropRecordStatus(
  record: AirdropEligibilityRecord,
): AirdropClaimRecordStatus {
  if (record.claimed || record.status === 'claimed') return 'claimed';
  // Pending is deliberately terminal from the status endpoint's perspective.
  // An expired reservation is retried with the same idempotency key; it must
  // never silently become a fresh eligible claim.
  if (record.status === 'pending') return 'pending';
  if (record.status === 'failed') return 'failed';
  return 'eligible';
}

export function canRetryAirdropReservation(
  record: AirdropEligibilityRecord,
  now = Date.now(),
): boolean {
  return (
    record.status === 'pending' &&
    !record.operationId &&
    typeof record.attemptId === 'string' &&
    record.attemptId.length > 0 &&
    typeof record.reservationExpiresAt === 'number' &&
    record.reservationExpiresAt <= now
  );
}

export function createAirdropReservation(
  record: AirdropEligibilityRecord,
  now: number,
  lifetimeMs: number,
  createAttemptId: () => string = () => crypto.randomUUID(),
): AirdropEligibilityRecord {
  const retrying = canRetryAirdropReservation(record, now);
  return {
    ...record,
    attemptId: retrying ? record.attemptId : createAttemptId(),
    claimed: false,
    operationId: retrying ? record.operationId : undefined,
    reservedAt: now,
    reservationExpiresAt: now + lifetimeMs,
    failedAt: undefined,
    failureReason: undefined,
    status: 'pending',
  };
}
