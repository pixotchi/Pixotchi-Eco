export const VERIFY_PENDING_TTL_SECONDS = 10 * 60;
export const VERIFY_CLAIM_RESERVATION_TTL_SECONDS = 15 * 60;
export const VERIFY_CLAIM_LOCK_TTL_SECONDS = VERIFY_CLAIM_RESERVATION_TTL_SECONDS;
export const VERIFY_RETRYABLE_FAILURE_TTL_SECONDS = 10 * 60;

export type VerifyPendingRecord = {
  status: 'verified_pending';
  token: string;
  address: string;
  provider: string;
  action: string;
  createdAt: number;
  expiresAt: number;
};

export type VerifyClaimReservationRecord = {
  status: 'pending';
  userAddress: string;
  verificationToken: string;
  provider: string;
  strainId: number;
  createdAt: number;
  expiresAt: number;
};

export type VerifyClaimRetryableFailureRecord = Omit<VerifyClaimReservationRecord, 'status'> & {
  status: 'claim_failed_retryable';
  failedAt: number;
  error: string;
};

export function normalizeVerifyWalletAddress(address: string): string | null {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return null;
  }
  return address.toLowerCase();
}

export function getVerifyPendingKey(token: string): string {
  return `verify:pending:${token}`;
}

export function getVerifyClaimKey(token: string): string {
  return `verified_claims:${token}`;
}

export function getVerifyWalletClaimKey(address: string): string {
  return `wallet_claims:${address.toLowerCase()}`;
}

export function getVerifyClaimLockKey(token: string): string {
  return `claim_lock:${token}`;
}

export function getVerifyWalletLockKey(address: string): string {
  return `claim_wallet_lock:${address.toLowerCase()}`;
}

