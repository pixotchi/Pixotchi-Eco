import { createHash, randomUUID } from 'node:crypto';
import { redis } from '@/lib/redis';

export const VERIFY_PENDING_TTL_SECONDS = 10 * 60;
export const VERIFY_CLAIM_RESERVED_LEASE_MS = 5 * 60 * 1000;

export type VerifyPendingRecord = {
  status: 'verified_pending';
  token: string;
  address: string;
  provider: string;
  action: string;
  createdAt: number;
  expiresAt: number;
};

export type VerifyClaimStage =
  | 'reserved'
  | 'mint_submitting'
  | 'mint_submitted'
  | 'mint_confirmed'
  | 'transfer_ready'
  | 'transfer_submitting'
  | 'transfer_submitted'
  | 'complete'
  | 'manual_review'
  | 'failed_before_submission';

export type VerifyClaimStatus =
  | 'pending'
  | 'complete'
  | 'mint_complete_transfer_pending'
  | 'transfer_failed'
  | 'claim_failed_manual_review'
  | 'claim_failed_before_submission';

export type VerifyClaimIdempotencyKeys = {
  mint: string;
  transfer: string;
  leafBonus: string;
  seedBonus: string;
};

/**
 * A claim reservation is permanent from the moment it is created. In
 * particular, it must not expire after a CDP request could have been accepted:
 * an operator can reconcile the persisted reservation and reuse its operation
 * keys without risking a second mint or transfer.
 */
export type VerifyClaimReservationRecord = {
  recordVersion: 2;
  reservationId: string;
  /** Rotates whenever a retry takes ownership of this reservation. */
  attemptId: string;
  status: VerifyClaimStatus;
  stage: VerifyClaimStage;
  userAddress: string;
  verificationToken: string;
  provider: string;
  strainId: number;
  createdAt: number;
  updatedAt: number;
  timestamp: number;
  idempotencyKeys: VerifyClaimIdempotencyKeys;
  agentAddress?: string;
  mintUserOpHash?: string;
  mintTxHash?: string;
  transferUserOpHash?: string;
  transferTxHash?: string | null;
  tokenId?: string;
  failedAt?: number;
  error?: string;
  transferError?: string | null;
  leafBonusStage?: 'disabled' | 'pending' | 'submitting' | 'submitted' | 'complete' | 'failed' | 'skipped' | 'manual_review';
  leafBonusUserOpHash?: string;
  leafBonusSent?: boolean;
  leafBonusTxHash?: string | null;
  leafBonusAmount?: string | null;
  leafBonusError?: string;
  seedBonusStage?: 'disabled' | 'pending' | 'submitting' | 'submitted' | 'complete' | 'failed' | 'skipped' | 'manual_review';
  seedBonusUserOpHash?: string;
  seedBonusSent?: boolean;
  seedBonusTxHash?: string | null;
  seedBonusAmount?: string | null;
  seedBonusError?: string;
};

export type VerifyClaimJSONReadResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'missing' }
  | { status: 'unavailable'; error: unknown };

export type VerifyClaimReserveResult =
  | { status: 'reserved' }
  | { status: 'conflict' }
  | { status: 'unavailable'; error: unknown };

export type VerifyClaimPairState =
  | 'unclaimed'
  | 'retryable'
  | 'processing'
  | 'complete'
  | 'manual_review';

type VerifyClaimRedisClient = {
  get(key: string): Promise<unknown>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
};

const RESERVE_CLAIM_PAIR_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], ARGV[1])
return 1
`;

const WRITE_CLAIM_PAIR_SCRIPT = `
local claim = redis.call('GET', KEYS[1])
local wallet = redis.call('GET', KEYS[2])
if not claim or not wallet then
  return 0
end
local claimOk, claimRecord = pcall(cjson.decode, claim)
local walletOk, walletRecord = pcall(cjson.decode, wallet)
if not claimOk or not walletOk then
  return 0
end
if claimRecord.reservationId ~= ARGV[2] or walletRecord.reservationId ~= ARGV[2]
  or claimRecord.attemptId ~= ARGV[3] or walletRecord.attemptId ~= ARGV[3] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], ARGV[1])
return 1
`;

const RESUME_BEFORE_SUBMISSION_PAIR_SCRIPT = `
local claim = redis.call('GET', KEYS[1])
local wallet = redis.call('GET', KEYS[2])
if not claim or not wallet then
  return 0
end
local claimOk, claimRecord = pcall(cjson.decode, claim)
local walletOk, walletRecord = pcall(cjson.decode, wallet)
if not claimOk or not walletOk then
  return 0
end
if claimRecord.reservationId ~= ARGV[2] or walletRecord.reservationId ~= ARGV[2]
  or claimRecord.attemptId ~= ARGV[3] or walletRecord.attemptId ~= ARGV[3] then
  return 0
end
if claimRecord.status ~= ARGV[4] or walletRecord.status ~= ARGV[4]
  or claimRecord.stage ~= ARGV[5] or walletRecord.stage ~= ARGV[5] then
  return 0
end
if ARGV[6] ~= '' then
  local cutoff = tonumber(ARGV[6])
  local claimUpdatedAt = tonumber(claimRecord.updatedAt)
  local walletUpdatedAt = tonumber(walletRecord.updatedAt)
  if not cutoff or not claimUpdatedAt or not walletUpdatedAt
    or claimUpdatedAt > cutoff or walletUpdatedAt > cutoff then
    return 0
  end
end
if claimRecord.verificationToken ~= walletRecord.verificationToken
  or claimRecord.userAddress ~= walletRecord.userAddress
  or claimRecord.provider ~= walletRecord.provider
  or claimRecord.strainId ~= walletRecord.strainId then
  return 0
end
if not claimRecord.idempotencyKeys or not walletRecord.idempotencyKeys
  or claimRecord.idempotencyKeys.mint ~= walletRecord.idempotencyKeys.mint
  or claimRecord.idempotencyKeys.transfer ~= walletRecord.idempotencyKeys.transfer
  or claimRecord.idempotencyKeys.leafBonus ~= walletRecord.idempotencyKeys.leafBonus
  or claimRecord.idempotencyKeys.seedBonus ~= walletRecord.idempotencyKeys.seedBonus
  or claimRecord.idempotencyKeys.mint ~= ARGV[7]
  or claimRecord.idempotencyKeys.transfer ~= ARGV[8]
  or claimRecord.idempotencyKeys.leafBonus ~= ARGV[9]
  or claimRecord.idempotencyKeys.seedBonus ~= ARGV[10] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], ARGV[1])
return 1
`;

function defaultRedisClient(): VerifyClaimRedisClient | null {
  return redis as unknown as VerifyClaimRedisClient | null;
}

function parseStoredJSON<T>(raw: unknown): T {
  if (typeof raw === 'string') return JSON.parse(raw) as T;
  return raw as T;
}

/** Read a raw verify key without collapsing a Redis outage into "missing". */
export async function readVerifyClaimJSON<T>(
  key: string,
  client: VerifyClaimRedisClient | null = defaultRedisClient(),
): Promise<VerifyClaimJSONReadResult<T>> {
  if (!client) {
    return { status: 'unavailable', error: new Error('Redis is not configured') };
  }

  try {
    const raw = await client.get(key);
    if (raw == null) return { status: 'missing' };
    return { status: 'ok', value: parseStoredJSON<T>(raw) };
  } catch (error) {
    return { status: 'unavailable', error };
  }
}

/**
 * Atomically claims both the verification-token and wallet namespaces. The
 * record has no TTL: even a process crash immediately after this call leaves a
 * durable recovery handle and prevents a fresh reservation.
 */
export async function reserveVerifyClaimPair(
  claimKey: string,
  walletClaimKey: string,
  record: VerifyClaimReservationRecord,
  client: VerifyClaimRedisClient | null = defaultRedisClient(),
): Promise<VerifyClaimReserveResult> {
  if (!client) {
    return { status: 'unavailable', error: new Error('Redis is not configured') };
  }

  try {
    const result = await client.eval(
      RESERVE_CLAIM_PAIR_SCRIPT,
      [claimKey, walletClaimKey],
      [JSON.stringify(record)],
    );
    return Number(result) === 1 ? { status: 'reserved' } : { status: 'conflict' };
  } catch (error) {
    return { status: 'unavailable', error };
  }
}

/** Atomically mirrors a recovery record into both claim indexes. */
export async function writeVerifyClaimPair(
  claimKey: string,
  walletClaimKey: string,
  record: VerifyClaimReservationRecord,
  client: VerifyClaimRedisClient | null = defaultRedisClient(),
): Promise<boolean> {
  if (!client) return false;

  try {
    const result = await client.eval(
      WRITE_CLAIM_PAIR_SCRIPT,
      [claimKey, walletClaimKey],
      [JSON.stringify(record), record.reservationId, record.attemptId],
    );
    return Number(result) === 1;
  } catch {
    return false;
  }
}

/**
 * A recorded pre-submission failure or an expired `reserved` lease can be
 * resumed. Atomically rotate the attempt owner in both indexes so the previous
 * handler cannot later cross the mint-submission fence.
 */
export async function resumeVerifyClaimPairBeforeSubmission(
  claimKey: string,
  walletClaimKey: string,
  previousRecord: VerifyClaimReservationRecord,
  resumedRecord: VerifyClaimReservationRecord,
  now = Date.now(),
  client: VerifyClaimRedisClient | null = defaultRedisClient(),
): Promise<VerifyClaimReserveResult> {
  if (!client) {
    return { status: 'unavailable', error: new Error('Redis is not configured') };
  }

  const explicitFailure = canResumeVerifyClaimBeforeSubmission(previousRecord);
  const staleReservation = canResumeStaleVerifyClaimReservation(previousRecord, now);
  if (
    (!explicitFailure && !staleReservation)
    || resumedRecord.reservationId !== previousRecord.reservationId
    || resumedRecord.status !== 'pending'
    || resumedRecord.stage !== 'reserved'
    || resumedRecord.verificationToken !== previousRecord.verificationToken
    || resumedRecord.userAddress !== previousRecord.userAddress
    || resumedRecord.provider !== previousRecord.provider
    || resumedRecord.strainId !== previousRecord.strainId
    || typeof previousRecord.attemptId !== 'string'
    || typeof resumedRecord.attemptId !== 'string'
    || resumedRecord.attemptId === previousRecord.attemptId
    || !sameIdempotencyKeys(resumedRecord.idempotencyKeys, previousRecord.idempotencyKeys)
  ) {
    return { status: 'conflict' };
  }

  try {
    const result = await client.eval(
      RESUME_BEFORE_SUBMISSION_PAIR_SCRIPT,
      [claimKey, walletClaimKey],
      [
        JSON.stringify(resumedRecord),
        previousRecord.reservationId,
        previousRecord.attemptId,
        explicitFailure ? 'claim_failed_before_submission' : 'pending',
        explicitFailure ? 'failed_before_submission' : 'reserved',
        staleReservation ? String(now - VERIFY_CLAIM_RESERVED_LEASE_MS) : '',
        previousRecord.idempotencyKeys.mint,
        previousRecord.idempotencyKeys.transfer,
        previousRecord.idempotencyKeys.leafBonus,
        previousRecord.idempotencyKeys.seedBonus,
      ],
    );
    return Number(result) === 1 ? { status: 'reserved' } : { status: 'conflict' };
  } catch (error) {
    return { status: 'unavailable', error };
  }
}

/** Prove that no mint, transfer, or bonus operation could already be live. */
export function canResumeVerifyClaimBeforeSubmission(
  record: VerifyClaimReservationRecord,
): boolean {
  return (
    record.status === 'claim_failed_before_submission'
    && record.stage === 'failed_before_submission'
    && hasNoSubmittedOperation(record)
  );
}

function hasNoSubmittedOperation(record: VerifyClaimReservationRecord): boolean {
  return (
    !record.mintUserOpHash
    && !record.mintTxHash
    && !record.transferUserOpHash
    && !record.transferTxHash
    && !record.tokenId
    && !record.leafBonusUserOpHash
    && !record.leafBonusTxHash
    && record.leafBonusSent !== true
    && !record.seedBonusUserOpHash
    && !record.seedBonusTxHash
    && record.seedBonusSent !== true
  );
}

/** Only the state before the durable mint-submission fence may age into retryability. */
export function canResumeStaleVerifyClaimReservation(
  record: VerifyClaimReservationRecord,
  now = Date.now(),
): boolean {
  return (
    record.status === 'pending'
    && record.stage === 'reserved'
    && Number.isFinite(record.updatedAt)
    && record.updatedAt <= now - VERIFY_CLAIM_RESERVED_LEASE_MS
    && hasNoSubmittedOperation(record)
  );
}

function sameIdempotencyKeys(
  left: VerifyClaimIdempotencyKeys,
  right: VerifyClaimIdempotencyKeys,
): boolean {
  return (
    typeof left?.mint === 'string'
    && left.mint.length > 0
    && typeof left.transfer === 'string'
    && left.transfer.length > 0
    && typeof left.leafBonus === 'string'
    && left.leafBonus.length > 0
    && typeof left.seedBonus === 'string'
    && left.seedBonus.length > 0
    && left.mint === right?.mint
    && left?.transfer === right?.transfer
    && left?.leafBonus === right?.leafBonus
    && left?.seedBonus === right?.seedBonus
  );
}

function isCurrentReservationRecord(value: unknown): value is VerifyClaimReservationRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<VerifyClaimReservationRecord>;
  return (
    record.recordVersion === 2
    && typeof record.reservationId === 'string'
    && record.reservationId.length > 0
    && typeof record.attemptId === 'string'
    && record.attemptId.length > 0
    && typeof record.verificationToken === 'string'
    && typeof record.userAddress === 'string'
    && typeof record.provider === 'string'
    && typeof record.strainId === 'number'
    && typeof record.createdAt === 'number'
    && typeof record.updatedAt === 'number'
    && !!record.idempotencyKeys
  );
}

function isSameVerifyClaimPair(
  claimRecord: VerifyClaimReservationRecord,
  walletRecord: VerifyClaimReservationRecord,
): boolean {
  const claimAddress = normalizeVerifyWalletAddress(claimRecord.userAddress);
  return (
    claimAddress !== null
    && claimRecord.reservationId === walletRecord.reservationId
    && claimRecord.attemptId === walletRecord.attemptId
    && claimRecord.verificationToken === walletRecord.verificationToken
    && claimAddress === normalizeVerifyWalletAddress(walletRecord.userAddress)
    && claimRecord.provider === walletRecord.provider
    && claimRecord.strainId === walletRecord.strainId
    && sameIdempotencyKeys(claimRecord.idempotencyKeys, walletRecord.idempotencyKeys)
  );
}

function isMatchingCompletedPair(claimValue: unknown, walletValue: unknown): boolean {
  if (
    !claimValue || typeof claimValue !== 'object' || Array.isArray(claimValue)
    || !walletValue || typeof walletValue !== 'object' || Array.isArray(walletValue)
  ) return false;
  const claimRecord = claimValue as Partial<VerifyClaimReservationRecord>;
  const walletRecord = walletValue as Partial<VerifyClaimReservationRecord>;
  const claimAddress = typeof claimRecord.userAddress === 'string'
    ? normalizeVerifyWalletAddress(claimRecord.userAddress)
    : null;
  return (
    claimRecord.status === 'complete'
    && walletRecord.status === 'complete'
    && claimAddress !== null
    && typeof walletRecord.userAddress === 'string'
    && claimAddress === normalizeVerifyWalletAddress(walletRecord.userAddress)
    && typeof claimRecord.verificationToken === 'string'
    && claimRecord.verificationToken === walletRecord.verificationToken
  );
}

/** Fail-closed classification used by status, verification, and claim admission. */
export function getVerifyClaimPairState(
  claimValue: unknown,
  walletValue: unknown,
  now = Date.now(),
): VerifyClaimPairState {
  if (claimValue == null && walletValue == null) return 'unclaimed';

  const claimStatus = claimValue && typeof claimValue === 'object'
    ? (claimValue as { status?: unknown }).status
    : undefined;
  const walletStatus = walletValue && typeof walletValue === 'object'
    ? (walletValue as { status?: unknown }).status
    : undefined;
  if (isMatchingCompletedPair(claimValue, walletValue)) return 'complete';
  if (claimStatus === 'complete' || walletStatus === 'complete') return 'manual_review';

  if (!isCurrentReservationRecord(claimValue) || !isCurrentReservationRecord(walletValue)) {
    return 'manual_review';
  }
  if (!isSameVerifyClaimPair(claimValue, walletValue)) return 'manual_review';

  if (
    (canResumeVerifyClaimBeforeSubmission(claimValue)
      && canResumeVerifyClaimBeforeSubmission(walletValue))
    || (canResumeStaleVerifyClaimReservation(claimValue, now)
      && canResumeStaleVerifyClaimReservation(walletValue, now))
  ) {
    return 'retryable';
  }

  if (
    claimValue.status === 'pending'
    && walletValue.status === 'pending'
    && claimValue.stage === 'reserved'
    && walletValue.stage === 'reserved'
  ) {
    return 'processing';
  }

  return 'manual_review';
}

function idempotencyKeyFor(reservationId: string, operation: keyof VerifyClaimIdempotencyKeys): string {
  const digest = createHash('sha256')
    .update(`pixotchi:verify-claim:${reservationId}:${operation}`)
    .digest('hex');
  // CDP documents UUID idempotency keys. Preserve UUID syntax while deriving a
  // stable, operation-specific value from the durable reservation.
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function createVerifyClaimReservation(
  input: {
    userAddress: string;
    verificationToken: string;
    provider: string;
    strainId: number;
  },
  now = Date.now(),
  reservationId = randomUUID(),
): VerifyClaimReservationRecord {
  return {
    recordVersion: 2,
    reservationId,
    attemptId: randomUUID(),
    status: 'pending',
    stage: 'reserved',
    ...input,
    createdAt: now,
    updatedAt: now,
    timestamp: now,
    idempotencyKeys: {
      mint: idempotencyKeyFor(reservationId, 'mint'),
      transfer: idempotencyKeyFor(reservationId, 'transfer'),
      leafBonus: idempotencyKeyFor(reservationId, 'leafBonus'),
      seedBonus: idempotencyKeyFor(reservationId, 'seedBonus'),
    },
  };
}

export function advanceVerifyClaimRecord(
  record: VerifyClaimReservationRecord,
  update: Partial<VerifyClaimReservationRecord>,
  now = Date.now(),
): VerifyClaimReservationRecord {
  return {
    ...record,
    ...update,
    recordVersion: 2,
    reservationId: record.reservationId,
    attemptId: record.attemptId,
    idempotencyKeys: record.idempotencyKeys,
    updatedAt: now,
  };
}

export function createVerifyClaimRetryAttempt(
  record: VerifyClaimReservationRecord,
  now = Date.now(),
  attemptId = randomUUID(),
): VerifyClaimReservationRecord {
  return {
    ...advanceVerifyClaimRecord(record, {
      status: 'pending',
      stage: 'reserved',
      failedAt: undefined,
      error: undefined,
    }, now),
    attemptId,
  };
}

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

/** Read both indexes before describing a reservation as a delivered claim. */
export async function readVerifyWalletClaimState(
  address: string,
  client: VerifyClaimRedisClient | null = defaultRedisClient(),
) {
  const wallet = await readVerifyClaimJSON<Partial<VerifyClaimReservationRecord>>(getVerifyWalletClaimKey(address), client);
  if (wallet.status === 'unavailable') throw new Error('Verify claim status is unavailable');
  const record = wallet.status === 'ok' ? wallet.value : null;
  const claim = typeof record?.verificationToken === 'string'
    ? await readVerifyClaimJSON(getVerifyClaimKey(record.verificationToken), client)
    : { status: 'missing' as const };
  if (claim.status === 'unavailable') throw new Error('Verify claim status is unavailable');
  const claimState = getVerifyClaimPairState(claim.status === 'ok' ? claim.value : null, record);
  return {
    claimed: claimState === 'complete',
    claimState,
    retryable: claimState === 'retryable',
    blocksNewClaim: claimState !== 'unclaimed' && claimState !== 'retryable',
    claimData: record ? {
      status: record.status,
      strainId: record.strainId,
      timestamp: record.timestamp,
      tokenId: record.tokenId,
    } : null,
  };
}

export function getVerifyClaimLockKey(token: string): string {
  return `claim_lock:${token}`;
}

export function getVerifyWalletLockKey(address: string): string {
  return `claim_wallet_lock:${address.toLowerCase()}`;
}
