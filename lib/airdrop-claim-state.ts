import type { AirdropExecution, AirdropProof } from './airdrop-execution';

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
  execution?: AirdropExecution;
  recoveryState?: 'manual_review';
  confirmedProof?: AirdropProof;
  /** Operator-reviewed legacy linkage, never a new payout authorization. */
  reconciliation?: { reviewedAt: number; evidence: string; agentAddress: string };
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
  // A missing operation identifier never proves that an old payout was unpaid.
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
    record.execution?.version === 2 &&
    record.recoveryState !== 'manual_review' &&
    ['reserved', 'prepared', 'signed', 'broadcasting'].includes(record.execution.phase) &&
    record.execution.leaseExpiresAt <= now
  );
}

export function createAirdropReservation(
  record: AirdropEligibilityRecord,
  now: number,
  lifetimeMs: number,
  createAttemptId: () => string = () => crypto.randomUUID(),
): AirdropEligibilityRecord {
  if (getAirdropRecordStatus(record) === 'pending' && !canRetryAirdropReservation(record, now)) {
    throw new Error('An ambiguous airdrop reservation cannot be replaced');
  }
  if (record.status === 'failed' && record.confirmedProof?.success !== false) {
    throw new Error('A failed provider status does not prove that an allocation was unpaid');
  }
  const retrying = canRetryAirdropReservation(record, now);
  return {
    ...record,
    attemptId: retrying ? record.attemptId : createAttemptId(),
    claimed: false,
    operationId: retrying ? record.operationId : undefined,
    reservedAt: retrying ? record.reservedAt : now,
    reservationExpiresAt: now + lifetimeMs,
    failedAt: undefined,
    failureReason: undefined,
    status: 'pending',
  };
}
