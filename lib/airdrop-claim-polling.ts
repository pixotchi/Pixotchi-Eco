export const AIRDROP_PENDING_POLL_MAX_ATTEMPTS = 8;

export function shouldPollAirdropStatus(status: { status?: string; recoveryState?: string; retryAllowed?: boolean } | null): boolean {
  return status?.status === 'pending' && status.recoveryState !== 'manual_review' && status.retryAllowed !== true;
}

const AIRDROP_PENDING_POLL_BASE_MS = 5_000;
const AIRDROP_PENDING_POLL_MAX_MS = 60_000;
const AIRDROP_PENDING_POLL_JITTER_RATIO = 0.2;

/** Returns a capped exponential delay with bounded symmetric jitter. */
export function getAirdropPendingPollDelay(
  attempt: number,
  random: number = Math.random(),
): number {
  const normalizedAttempt = Number.isFinite(attempt)
    ? Math.max(0, Math.floor(attempt))
    : 0;
  const cappedDelay = Math.min(
    AIRDROP_PENDING_POLL_BASE_MS * (2 ** normalizedAttempt),
    AIRDROP_PENDING_POLL_MAX_MS,
  );
  const normalizedRandom = Number.isFinite(random)
    ? Math.min(1, Math.max(0, random))
    : 0.5;
  const jitter = Math.round(
    cappedDelay * AIRDROP_PENDING_POLL_JITTER_RATIO * ((normalizedRandom * 2) - 1),
  );
  return Math.min(AIRDROP_PENDING_POLL_MAX_MS, Math.max(1, cappedDelay + jitter));
}
