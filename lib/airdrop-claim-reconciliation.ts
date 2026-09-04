import type { Hex } from 'viem';
import type { AirdropEligibilityRecord } from '@/lib/airdrop-claim-state';

export type AirdropOperationOutcome = 'complete' | 'failed' | 'pending' | 'unknown';

const USER_OPERATION_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const TRANSACTION_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

/**
 * CDP may expose intermediate operation states while a bundler is processing
 * the request. Only its terminal states are safe to persist as terminal claim
 * states; a broadcast operation remains pending until its Base receipt exists.
 */
export function getAirdropOperationOutcome(status: unknown): AirdropOperationOutcome {
  switch (status) {
    case 'complete':
      return 'complete';
    case 'failed':
    case 'dropped':
      return 'failed';
    case 'pending':
    case 'signed':
    case 'broadcast':
      return 'pending';
    default:
      return 'unknown';
  }
}

export function isAirdropUserOperationHash(value: unknown): value is Hex {
  return typeof value === 'string' && USER_OPERATION_HASH_PATTERN.test(value);
}

export function isAirdropTransactionHash(value: unknown): value is Hex {
  return typeof value === 'string' && TRANSACTION_HASH_PATTERN.test(value);
}

export function createFailedAirdropClaimRecord(
  record: AirdropEligibilityRecord,
  now = Date.now(),
): AirdropEligibilityRecord {
  return {
    ...record,
    claimed: false,
    failedAt: now,
    failureReason: 'Claim operation failed',
    status: 'failed',
    txHash: undefined,
  };
}

export function createClaimedAirdropRecord(
  record: AirdropEligibilityRecord,
  txHash: Hex,
  now = Date.now(),
): AirdropEligibilityRecord {
  return {
    ...record,
    claimed: true,
    claimedAt: now,
    failedAt: undefined,
    failureReason: undefined,
    status: 'claimed',
    txHash,
  };
}
