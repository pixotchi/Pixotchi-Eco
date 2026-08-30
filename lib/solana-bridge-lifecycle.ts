import type { Connection, SignatureResult } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  padHex,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { getBaseReadClient } from './base-rpc';
import {
  BRIDGE_CONFIG,
  SOLANA_BRIDGE_CONFIG,
  SOLANA_TWIN_ADAPTER_ABI,
  getPixotchiSolanaConfig,
} from './solana-constants';

const BRIDGE_VALIDATOR_ABI = [
  {
    name: 'validMessages',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

const BASE_BRIDGE_ABI = [
  {
    name: 'successes',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'failures',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

export type SolanaBridgeLifecyclePhase =
  | 'submitted'
  | 'solana-confirming'
  | 'solana-confirmed'
  | 'relay-pending'
  | 'base-confirmed';

export type BaseBridgeExecutionStatus =
  | 'pending-message'
  | 'pending-validation'
  | 'pending-relay'
  | 'relay-failed'
  | 'base-confirmed'
  | 'unknown';

export interface BridgeTransactionMetadata {
  outgoingMessageAddress: string;
  messageToRelayAddress: string;
  relayInstructionIncluded: boolean;
  gasLimit: bigint;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}

export interface BaseBridgeExecutionResult {
  status: BaseBridgeExecutionStatus;
  messageHash?: Hex;
}

export interface PendingBridgeAction {
  version: 2;
  kind: 'submitted';
  /** Wallet-scoped persistence key (one active bridge spend per wallet). */
  actionKey: string;
  /** Immutable physical attempt identity. */
  attemptId: string;
  /** Exact requested action/parameter identity at submission time. */
  requestKey: string;
  requestedAction: string;
  createdAt: number;
  signature: string;
  outgoingMessageAddress: string;
  messageHash?: Hex;
  implicitSetup: boolean;
  solanaConfirmed: boolean;
  twinAddress: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}

export interface PendingBridgeReservation {
  version: 2;
  kind: 'reservation';
  /** Wallet-scoped persistence key (one active bridge spend per wallet). */
  actionKey: string;
  /** Immutable physical attempt identity and reservation owner. */
  attemptId: string;
  /** Exact requested action/parameter identity before wallet submission. */
  requestKey: string;
  requestedAction: string;
  createdAt: number;
  phase: 'preparing' | 'wallet-pending';
  outgoingMessageAddress?: string;
  implicitSetup?: boolean;
  twinAddress?: string;
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
  /** Reserves enough quota for the larger submitted lifecycle record. */
  reservationPadding: string;
}

export interface PendingBridgeWalletMetadata {
  outgoingMessageAddress: string;
  implicitSetup: boolean;
  twinAddress: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}

export type PendingBridgeWalletReservation = PendingBridgeReservation
  & PendingBridgeWalletMetadata
  & { phase: 'wallet-pending' };

export type PendingBridgeRecord = PendingBridgeAction | PendingBridgeReservation;

export interface PendingBridgeActionChange {
  actionKey: string;
  record: PendingBridgeRecord | null;
}

export type PendingBridgeStorage = Pick<
  Storage,
  'getItem' | 'key' | 'length' | 'removeItem' | 'setItem'
>;

export type PendingBridgeReservationResult =
  | { acquired: true; reservation: PendingBridgeReservation }
  | {
      acquired: false;
      blocker: PendingBridgeRecord | null;
      reason: 'active-record' | 'contended';
    };

export type PendingBridgeWalletRecoveryResult =
  | { status: 'submitted'; action: PendingBridgeAction }
  | { status: 'cleared'; reason: 'expired-absent' }
  | {
      status: 'pending';
      reason: 'ambiguous' | 'landed-without-signature' | 'unexpired';
    };

export class PendingBridgeStorageUnavailableError extends Error {
  constructor() {
    super('Safe Solana transaction tracking requires browser storage. Enable site storage, then try again.');
    this.name = 'PendingBridgeStorageUnavailableError';
  }
}

export class SolanaTransactionExecutionError extends Error {
  constructor(signature: string, error: unknown) {
    super(`Solana transaction ${signature} failed: ${formatChainError(error)}`);
    this.name = 'SolanaTransactionExecutionError';
  }
}

export class SolanaConfirmationTimeoutError extends Error {
  constructor(signature: string) {
    super(`Solana confirmation is still pending for ${signature}`);
    this.name = 'SolanaConfirmationTimeoutError';
  }
}

export class SolanaTransactionExpiredError extends Error {
  constructor(signature: string) {
    super(`Solana transaction ${signature} expired before confirmation and can be retried`);
    this.name = 'SolanaTransactionExpiredError';
  }
}

function formatChainError(error: unknown): string {
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertSuccessfulSignatureResult(signature: string, result: SignatureResult): void {
  if (result.err !== null) {
    throw new SolanaTransactionExecutionError(signature, result.err);
  }
}

type SolanaConfirmationConnection = Pick<
  Connection,
  'confirmTransaction' | 'getSignatureStatuses'
> & Partial<Pick<Connection, 'getAccountInfo' | 'getBlockHeight'>>;

function isConfirmedSignatureStatus(
  signature: string,
  status: Awaited<ReturnType<Connection['getSignatureStatuses']>>['value'][number],
): boolean {
  if (!status) return false;
  if (status.err !== null) throw new SolanaTransactionExecutionError(signature, status.err);
  return status.confirmationStatus === 'confirmed'
    || status.confirmationStatus === 'finalized'
    // Older RPC nodes can omit confirmationStatus; null confirmations means
    // the signature is rooted/finalized.
    || (status.confirmationStatus == null && status.confirmations === null);
}

async function resolveDefinitiveSolanaExpiry(
  connection: SolanaConfirmationConnection,
  signature: string,
  options: { lastValidBlockHeight?: number; outgoingMessageAddress?: string },
): Promise<'confirmed' | 'expired' | 'ambiguous'> {
  if (
    options.lastValidBlockHeight === undefined
    || !options.outgoingMessageAddress
    || !connection.getAccountInfo
    || !connection.getBlockHeight
  ) {
    return 'ambiguous';
  }

  let outgoingAddress: PublicKey;
  try {
    outgoingAddress = new PublicKey(options.outgoingMessageAddress);
  } catch {
    return 'ambiguous';
  }

  // Expiry is destructive evidence because its caller may unlock a duplicate
  // spend. Require a fresh finalized-height read plus both absence signals,
  // and prefer any landed signature/account evidence over expiry.
  const [statusResult, accountResult, blockHeightResult] = await Promise.allSettled([
    connection.getSignatureStatuses([signature], { searchTransactionHistory: true }),
    connection.getAccountInfo(outgoingAddress, 'finalized'),
    connection.getBlockHeight('finalized'),
  ]);
  if (statusResult.status === 'fulfilled') {
    const status = statusResult.value.value[0];
    if (isConfirmedSignatureStatus(signature, status)) return 'confirmed';
    if (status) return 'ambiguous';
  }
  if (accountResult.status === 'fulfilled' && accountResult.value !== null) {
    return 'ambiguous';
  }
  return statusResult.status === 'fulfilled'
    && statusResult.value.value[0] === null
    && accountResult.status === 'fulfilled'
    && accountResult.value === null
    && blockHeightResult.status === 'fulfilled'
    && blockHeightResult.value > options.lastValidBlockHeight
    ? 'expired'
    : 'ambiguous';
}

/**
 * Establish wallet-independent Solana confirmation. Program errors are final
 * and are never converted into a transport fallback or a success callback.
 */
export async function confirmSolanaTransaction(
  connection: SolanaConfirmationConnection,
  signature: string,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    onPhase?: (phase: SolanaBridgeLifecyclePhase) => void;
    blockhash?: string;
    lastValidBlockHeight?: number;
    outgoingMessageAddress?: string;
  } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? BRIDGE_CONFIG.solanaConfirmationTimeoutMs;
  const pollMs = options.pollMs ?? BRIDGE_CONFIG.solanaConfirmationPollMs;
  options.onPhase?.('solana-confirming');

  try {
    const confirmation = options.blockhash && options.lastValidBlockHeight !== undefined
      ? await connection.confirmTransaction(
          {
            signature,
            blockhash: options.blockhash,
            lastValidBlockHeight: options.lastValidBlockHeight,
          },
          'confirmed',
        )
      : await connection.confirmTransaction(signature, 'confirmed');
    assertSuccessfulSignatureResult(signature, confirmation.value);
    options.onPhase?.('solana-confirmed');
    return;
  } catch (error) {
    if (error instanceof SolanaTransactionExecutionError) throw error;
    const reportedExpired = (
      error instanceof SolanaTransactionExpiredError ||
      (error instanceof Error && /block height exceeded|expired/i.test(error.message))
    );
    if (reportedExpired) {
      const expiry = await resolveDefinitiveSolanaExpiry(connection, signature, options);
      if (expiry === 'confirmed') {
        options.onPhase?.('solana-confirmed');
        return;
      }
      if (expiry === 'expired') throw new SolanaTransactionExpiredError(signature);
    }
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const statuses = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = statuses.value[0];

    if (status?.err !== null && status?.err !== undefined) {
      throw new SolanaTransactionExecutionError(signature, status.err);
    }

    if (isConfirmedSignatureStatus(signature, status)) {
      options.onPhase?.('solana-confirmed');
      return;
    }

    if (
      options.lastValidBlockHeight !== undefined &&
      connection.getBlockHeight &&
      (await connection.getBlockHeight('finalized')) > options.lastValidBlockHeight
    ) {
      const expiry = await resolveDefinitiveSolanaExpiry(connection, signature, options);
      if (expiry === 'confirmed') {
        options.onPhase?.('solana-confirmed');
        return;
      }
      if (expiry === 'expired') throw new SolanaTransactionExpiredError(signature);
    }

    await delay(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }

  throw new SolanaConfirmationTimeoutError(signature);
}

interface DecodedCall {
  ty: number;
  to: Address;
  value: bigint;
  data: Hex;
}

interface DecodedTransfer {
  to: Hex;
  localToken: string;
  remoteToken: Address;
  amount: bigint;
  call: DecodedCall | null;
}

interface DecodedOutgoingMessage {
  nonce: bigint;
  sender: string;
  transfer: DecodedTransfer;
}

function readU64LE(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset + offset, 8).getBigUint64(0, true);
}

function readU128LE(data: Uint8Array, offset: number): bigint {
  const low = readU64LE(data, offset);
  const high = readU64LE(data, offset + 8);
  return low + (high << BigInt(64));
}

function readU32LE(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true);
}

function sliceHex(data: Uint8Array, start: number, length: number): Hex {
  return toHex(data.slice(start, start + length));
}

function decodeCall(data: Uint8Array, initialOffset: number): DecodedCall {
  let offset = initialOffset;
  const ty = data[offset];
  offset += 1;
  const to = sliceHex(data, offset, 20) as Address;
  offset += 20;
  const value = readU128LE(data, offset);
  offset += 16;
  const dataLength = readU32LE(data, offset);
  offset += 4;

  return {
    ty,
    to,
    value,
    data: sliceHex(data, offset, dataLength),
  };
}

function decodeOutgoingMessage(data: Uint8Array): DecodedOutgoingMessage {
  let offset = 8; // Anchor account discriminator
  const nonce = readU64LE(data, offset);
  offset += 8;
  const sender = new PublicKey(data.slice(offset, offset + 32)).toBase58();
  offset += 32;

  const variant = data[offset];
  offset += 1;
  if (variant !== 1) {
    throw new Error(`Unsupported outgoing bridge message variant: ${variant}`);
  }

  const to = sliceHex(data, offset, 20);
  offset += 20;
  const localToken = new PublicKey(data.slice(offset, offset + 32)).toBase58();
  offset += 32;
  const remoteToken = sliceHex(data, offset, 20) as Address;
  offset += 20;
  const amount = readU64LE(data, offset);
  offset += 8;
  const hasCall = data[offset];
  offset += 1;

  return {
    nonce,
    sender,
    transfer: {
      to,
      localToken,
      remoteToken,
      amount,
      call: hasCall === 1 ? decodeCall(data, offset) : null,
    },
  };
}

function publicKeyToBytes32(publicKey: string): Hex {
  return padHex(toHex(new PublicKey(publicKey).toBytes()), { size: 32 });
}

function getMessageHash(
  outgoingMessageAddress: string,
  outgoing: DecodedOutgoingMessage,
): Hex {
  const transferTuple = {
    localToken: outgoing.transfer.remoteToken,
    remoteToken: publicKeyToBytes32(outgoing.transfer.localToken),
    to: padHex(outgoing.transfer.to, { size: 32, dir: 'right' }),
    remoteAmount: outgoing.transfer.amount,
  } as const;

  const transferType = {
    type: 'tuple',
    components: [
      { name: 'localToken', type: 'address' },
      { name: 'remoteToken', type: 'bytes32' },
      { name: 'to', type: 'bytes32' },
      { name: 'remoteAmount', type: 'uint64' },
    ],
  } as const;

  let messageType = 1;
  let messageData = encodeAbiParameters([transferType], [transferTuple]);
  if (outgoing.transfer.call) {
    messageType = 2;
    const call = outgoing.transfer.call;
    messageData = encodeAbiParameters(
      [
        transferType,
        {
          type: 'tuple',
          components: [
            { name: 'ty', type: 'uint8' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint128' },
            { name: 'data', type: 'bytes' },
          ],
        },
      ],
      [transferTuple, call],
    );
  }

  const innerHash = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint8' }, { type: 'bytes' }],
      [publicKeyToBytes32(outgoing.sender), messageType, messageData],
    ),
  );

  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint64' }, { type: 'bytes32' }, { type: 'bytes32' }],
      [outgoing.nonce, publicKeyToBytes32(outgoingMessageAddress), innerHash],
    ),
  );
}

async function resolveMessageHash(
  connection: Pick<Connection, 'getAccountInfo'>,
  outgoingMessageAddress: string,
): Promise<Hex | null> {
  const account = await connection.getAccountInfo(new PublicKey(outgoingMessageAddress));
  if (!account) return null;
  return getMessageHash(outgoingMessageAddress, decodeOutgoingMessage(account.data));
}

async function readBaseExecutionStatus(messageHash: Hex): Promise<BaseBridgeExecutionStatus> {
  const client = getBaseReadClient();
  const [succeeded, failed, validated] = await Promise.all([
    client.readContract({
      address: SOLANA_BRIDGE_CONFIG.base.bridge as Address,
      abi: BASE_BRIDGE_ABI,
      functionName: 'successes',
      args: [messageHash],
    }),
    client.readContract({
      address: SOLANA_BRIDGE_CONFIG.base.bridge as Address,
      abi: BASE_BRIDGE_ABI,
      functionName: 'failures',
      args: [messageHash],
    }),
    client.readContract({
      address: SOLANA_BRIDGE_CONFIG.base.bridgeValidator as Address,
      abi: BRIDGE_VALIDATOR_ABI,
      functionName: 'validMessages',
      args: [messageHash],
    }),
  ]);

  // A later successful retry can coexist with an earlier recorded failure.
  if (succeeded) return 'base-confirmed';
  if (failed) return 'relay-failed';
  return validated ? 'pending-relay' : 'pending-validation';
}

/** Read the strongest currently available cross-chain completion evidence. */
export async function checkBaseBridgeExecution(
  connection: Pick<Connection, 'getAccountInfo'>,
  outgoingMessageAddress: string,
  knownMessageHash?: Hex,
): Promise<BaseBridgeExecutionResult> {
  try {
    const messageHash =
      knownMessageHash ?? (await resolveMessageHash(connection, outgoingMessageAddress));
    if (!messageHash) return { status: 'pending-message' };

    return {
      status: await readBaseExecutionStatus(messageHash),
      messageHash,
    };
  } catch {
    // RPC unavailability is unknown/pending, never an application failure.
    return { status: 'unknown', messageHash: knownMessageHash };
  }
}

/**
 * Poll Base execution for a bounded period. A timeout returns the latest pending
 * state so callers can persist and resume it without allowing a second spend.
 */
export async function waitForBaseBridgeExecution(
  connection: Pick<Connection, 'getAccountInfo'>,
  metadata: Pick<BridgeTransactionMetadata, 'outgoingMessageAddress'>,
  options: {
    timeoutMs?: number;
    knownMessageHash?: Hex;
    onPhase?: (phase: SolanaBridgeLifecyclePhase) => void;
  } = {},
): Promise<BaseBridgeExecutionResult> {
  const timeoutMs = options.timeoutMs ?? BRIDGE_CONFIG.relayInitialWaitMs;
  const deadline = Date.now() + timeoutMs;
  let latest: BaseBridgeExecutionResult = {
    status: 'pending-message',
    messageHash: options.knownMessageHash,
  };
  options.onPhase?.('relay-pending');

  do {
    latest = await checkBaseBridgeExecution(
      connection,
      metadata.outgoingMessageAddress,
      latest.messageHash,
    );
    if (latest.status === 'base-confirmed') {
      options.onPhase?.('base-confirmed');
      return latest;
    }
    if (latest.status === 'relay-failed') return latest;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await delay(Math.min(BRIDGE_CONFIG.relayStatusPollMs, remaining));
  } while (Date.now() < deadline);

  return latest;
}

/** Exact setup postcondition used after the setup bridge message succeeds. */
export async function verifySolanaTwinSetup(twinAddress: string): Promise<boolean> {
  const adapter = getPixotchiSolanaConfig().twinAdapter;
  if (!adapter) throw new Error('Solana Twin adapter is not configured');

  return getBaseReadClient().readContract({
    address: getAddress(adapter),
    abi: SOLANA_TWIN_ADAPTER_ABI,
    functionName: 'isTwinSetup',
    args: [getAddress(twinAddress)],
  });
}

const PENDING_STORAGE_PREFIX = 'pixotchi:solana-bridge:pending:v2';
const PENDING_RECORD_PREFIX = `${PENDING_STORAGE_PREFIX}:record`;
const PENDING_CLAIM_PREFIX = `${PENDING_STORAGE_PREFIX}:claim`;
const PENDING_RECORD_MAX_SIZE = 4_096;
const PENDING_STORAGE_SNAPSHOT_MAX_PASSES = 8;
const PENDING_CLAIM_LIFETIME_MS = 15_000;
const PENDING_CLAIM_SETTLE_MS = 60;
const PENDING_CLOCK_SKEW_MS = 5 * 60 * 1_000;
export const PENDING_BRIDGE_PREPARATION_STALE_MS = 2 * 60 * 1_000;
export const PENDING_BRIDGE_ACTION_EVENT = 'solana-bridge:pending-change';

const activePendingClaims = new Map<string, number>();

function createPendingBridgeAttemptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getPendingBridgeScope(actionKey: string): string {
  return encodeURIComponent(actionKey);
}

function getPendingBridgeRecordPrefix(actionKey: string): string {
  return `${PENDING_RECORD_PREFIX}:${getPendingBridgeScope(actionKey)}:attempt:`;
}

function getPendingBridgeRecordKey(record: Pick<PendingBridgeRecord, 'actionKey' | 'attemptId'>): string {
  return `${getPendingBridgeRecordPrefix(record.actionKey)}${record.attemptId}`;
}

function getPendingBridgeClaimPrefix(actionKey: string): string {
  return `${PENDING_CLAIM_PREFIX}:${getPendingBridgeScope(actionKey)}:`;
}

function getPendingBridgeClaimKey(actionKey: string, attemptId: string): string {
  return `${getPendingBridgeClaimPrefix(actionKey)}${attemptId}`;
}

export function getBrowserPendingBridgeStorage(): PendingBridgeStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function dispatchPendingBridgeChange(actionKey: string, record: PendingBridgeRecord | null): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<PendingBridgeActionChange>(PENDING_BRIDGE_ACTION_EVENT, {
      detail: { actionKey, record },
    }),
  );
}

type PendingStorageKeyCapture = {
  complete: boolean;
  failed: boolean;
  keys: string[];
};

function capturePendingStorageKeys(storage: PendingBridgeStorage): PendingStorageKeyCapture {
  const keys: string[] = [];
  try {
    const startLength = storage.length;
    if (!Number.isSafeInteger(startLength) || startLength < 0) {
      return { complete: false, failed: true, keys };
    }
    const seen = new Set<string>();
    for (let index = 0; index < startLength; index += 1) {
      const key = storage.key(index);
      if (key === null || seen.has(key)) {
        return { complete: false, failed: false, keys };
      }
      seen.add(key);
      keys.push(key);
    }
    if (storage.length !== startLength || seen.size !== startLength) {
      return { complete: false, failed: false, keys };
    }
    return { complete: true, failed: false, keys: keys.sort() };
  } catch {
    return { complete: false, failed: true, keys };
  }
}

function samePendingStorageKeys(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function collectStablePendingStorageEntries(
  storage: PendingBridgeStorage,
  isCandidate: (key: string) => boolean,
): { authoritative: boolean; keys: Set<string>; values: Map<string, string> } {
  const empty = () => ({
    authoritative: false,
    keys: new Set<string>(),
    values: new Map<string, string>(),
  });
  const observedCandidates = new Set<string>();
  let previousCompleteKeys: string[] | null = null;

  for (let pass = 0; pass < PENDING_STORAGE_SNAPSHOT_MAX_PASSES; pass += 1) {
    const capture = capturePendingStorageKeys(storage);
    for (const key of capture.keys) {
      if (isCandidate(key)) observedCandidates.add(key);
    }
    if (capture.failed) return { ...empty(), keys: observedCandidates };
    if (!capture.complete) {
      previousCompleteKeys = null;
      continue;
    }
    if (previousCompleteKeys === null || !samePendingStorageKeys(previousCompleteKeys, capture.keys)) {
      previousCompleteKeys = capture.keys;
      continue;
    }

    const values = new Map<string, string>();
    let candidateDisappeared = false;
    for (const key of observedCandidates) {
      try {
        const rawValue = storage.getItem(key);
        if (rawValue === null) {
          candidateDisappeared = true;
          break;
        }
        values.set(key, rawValue);
      } catch {
        return { ...empty(), keys: observedCandidates };
      }
    }
    if (candidateDisappeared) {
      observedCandidates.clear();
      previousCompleteKeys = null;
      continue;
    }

    const validation = capturePendingStorageKeys(storage);
    for (const key of validation.keys) {
      if (isCandidate(key)) observedCandidates.add(key);
    }
    if (validation.failed) return { ...empty(), keys: observedCandidates };
    if (!validation.complete || !samePendingStorageKeys(capture.keys, validation.keys)) {
      previousCompleteKeys = validation.complete ? validation.keys : null;
      continue;
    }

    let valuesChanged = false;
    for (const [key, rawValue] of values) {
      try {
        if (storage.getItem(key) !== rawValue) {
          valuesChanged = true;
          break;
        }
      } catch {
        return { ...empty(), keys: observedCandidates };
      }
    }
    if (valuesChanged) {
      previousCompleteKeys = validation.keys;
      continue;
    }
    return { authoritative: true, keys: observedCandidates, values };
  }

  return { ...empty(), keys: observedCandidates };
}

function isPendingBridgeAttemptId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 8
    && value.length <= 128
    && /^[A-Za-z0-9._-]+$/.test(value);
}

function isPendingBridgeRecord(
  value: unknown,
  actionKey: string,
  now: number,
): value is PendingBridgeRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PendingBridgeRecord>;
  const commonIsValid = record.version === 2
    && record.actionKey === actionKey
    && isPendingBridgeAttemptId(record.attemptId)
    && typeof record.requestKey === 'string'
    && record.requestKey.length > 0
    && record.requestKey.length <= 1_024
    && typeof record.requestedAction === 'string'
    && record.requestedAction.length > 0
    && record.requestedAction.length <= 64
    && typeof record.createdAt === 'number'
    && Number.isFinite(record.createdAt)
    && record.createdAt > 0
    && record.createdAt <= now + PENDING_CLOCK_SKEW_MS;
  if (!commonIsValid) return false;

  if (record.kind === 'reservation') {
    const reservationIsValid = (record.phase === 'preparing' || record.phase === 'wallet-pending')
      && typeof record.reservationPadding === 'string'
      && record.reservationPadding.length <= PENDING_RECORD_MAX_SIZE;
    if (!reservationIsValid || record.phase === 'preparing') return reservationIsValid;
    return typeof record.outgoingMessageAddress === 'string'
      && record.outgoingMessageAddress.length > 0
      && record.outgoingMessageAddress.length <= 128
      && typeof record.implicitSetup === 'boolean'
      && typeof record.twinAddress === 'string'
      && record.twinAddress.length > 0
      && record.twinAddress.length <= 128
      && typeof record.recentBlockhash === 'string'
      && record.recentBlockhash.length > 0
      && record.recentBlockhash.length <= 128
      && typeof record.lastValidBlockHeight === 'number'
      && Number.isSafeInteger(record.lastValidBlockHeight)
      && record.lastValidBlockHeight >= 0;
  }
  if (record.kind !== 'submitted') return false;
  return typeof record.signature === 'string'
    && record.signature.length > 0
    && record.signature.length <= 256
    && typeof record.outgoingMessageAddress === 'string'
    && record.outgoingMessageAddress.length > 0
    && record.outgoingMessageAddress.length <= 128
    && typeof record.implicitSetup === 'boolean'
    && typeof record.solanaConfirmed === 'boolean'
    && typeof record.twinAddress === 'string'
    && record.twinAddress.length > 0
    && record.twinAddress.length <= 128
    && typeof record.recentBlockhash === 'string'
    && record.recentBlockhash.length > 0
    && record.recentBlockhash.length <= 128
    && typeof record.lastValidBlockHeight === 'number'
    && Number.isSafeInteger(record.lastValidBlockHeight)
    && record.lastValidBlockHeight >= 0
    && (record.messageHash === undefined || /^0x[0-9a-f]{64}$/i.test(record.messageHash));
}

function isPendingBridgeRecordActive(record: PendingBridgeRecord, now = Date.now()): boolean {
  if (record.kind === 'submitted') {
    // A relay-failed or delayed bridge message can later settle successfully.
    // Submitted proof remains authoritative until a terminal chain result.
    return true;
  }
  if (record.phase === 'wallet-pending') {
    // No signature was returned to the app, so a wallet-pending reservation is
    // ambiguous and must never expire into an automatic duplicate submission.
    return true;
  }
  return now - record.createdAt < PENDING_BRIDGE_PREPARATION_STALE_MS;
}

function scanPendingBridgeRecords(
  actionKey: string,
  storage: PendingBridgeStorage,
  now = Date.now(),
): { authoritative: boolean; records: PendingBridgeRecord[] } {
  const prefix = getPendingBridgeRecordPrefix(actionKey);
  const snapshot = collectStablePendingStorageEntries(storage, (key) => key.startsWith(prefix));
  if (!snapshot.authoritative) return { authoritative: false, records: [] };

  const records: PendingBridgeRecord[] = [];
  for (const key of snapshot.keys) {
    const rawValue = snapshot.values.get(key);
    if (rawValue === undefined || rawValue.length > PENDING_RECORD_MAX_SIZE) {
      return { authoritative: false, records: [] };
    }
    try {
      const record = JSON.parse(rawValue) as unknown;
      if (!isPendingBridgeRecord(record, actionKey, now) || getPendingBridgeRecordKey(record) !== key) {
        return { authoritative: false, records: [] };
      }
      records.push(record);
    } catch {
      return { authoritative: false, records: [] };
    }
  }

  return {
    authoritative: true,
    records: records.sort((left, right) => left.createdAt - right.createdAt),
  };
}

function getActivePendingBridgeRecord(
  actionKey: string,
  storage: PendingBridgeStorage,
  now = Date.now(),
): { authoritative: boolean; record: PendingBridgeRecord | null } {
  const scan = scanPendingBridgeRecords(actionKey, storage, now);
  return {
    authoritative: scan.authoritative,
    record: scan.records.find((record) => isPendingBridgeRecordActive(record, now)) ?? null,
  };
}

export function loadPendingBridgeRecord(
  actionKey: string,
  storage = getBrowserPendingBridgeStorage(),
  now = Date.now(),
): PendingBridgeRecord | null {
  if (!storage) return null;
  const result = getActivePendingBridgeRecord(actionKey, storage, now);
  return result.authoritative ? result.record : null;
}

export function loadPendingBridgeAction(
  actionKey: string,
  storage = getBrowserPendingBridgeStorage(),
  now = Date.now(),
): PendingBridgeAction | null {
  const record = loadPendingBridgeRecord(actionKey, storage, now);
  return record?.kind === 'submitted' ? record : null;
}

export function canDurablyPersistPendingBridgeRecords(storage: PendingBridgeStorage | null): boolean {
  if (!storage) return false;
  const probeKey = `${PENDING_STORAGE_PREFIX}:probe:${createPendingBridgeAttemptId()}`;
  const probeValue = 'x'.repeat(PENDING_RECORD_MAX_SIZE + 256);
  let durable = false;
  try {
    storage.setItem(probeKey, probeValue);
    if (storage.getItem(probeKey) !== probeValue) return false;
    let discovered = false;
    for (let index = 0; index < storage.length; index += 1) {
      if (storage.key(index) === probeKey) {
        discovered = true;
        break;
      }
    }
    durable = discovered;
  } catch {
    durable = false;
  } finally {
    try {
      storage.removeItem(probeKey);
    } catch {
      // The failed probe is intentionally best effort on restricted storage.
    }
  }
  if (!durable) return false;
  try {
    return storage.getItem(probeKey) === null;
  } catch {
    return false;
  }
}

type PendingBridgeClaim = { expiresAt: number; attemptId: string };

function parsePendingBridgeClaim(rawValue: string | null, now = Date.now()): PendingBridgeClaim | null {
  if (!rawValue || rawValue.length > 512) return null;
  try {
    const claim = JSON.parse(rawValue) as Partial<PendingBridgeClaim>;
    if (
      !isPendingBridgeAttemptId(claim.attemptId)
      || typeof claim.expiresAt !== 'number'
      || !Number.isFinite(claim.expiresAt)
      || claim.expiresAt <= now
      || claim.expiresAt > now + PENDING_CLAIM_LIFETIME_MS
    ) {
      return null;
    }
    return { attemptId: claim.attemptId, expiresAt: claim.expiresAt };
  } catch {
    return null;
  }
}

function collectPendingBridgeClaims(
  actionKey: string,
  storage: PendingBridgeStorage,
  now = Date.now(),
): { authoritative: boolean; claims: Array<{ key: string; rawValue: string }> } {
  const prefix = getPendingBridgeClaimPrefix(actionKey);
  const snapshot = collectStablePendingStorageEntries(storage, (key) => key.startsWith(prefix));
  if (!snapshot.authoritative) return { authoritative: false, claims: [] };
  const claims: Array<{ key: string; rawValue: string }> = [];
  for (const key of snapshot.keys) {
    const rawValue = snapshot.values.get(key) ?? null;
    if (parsePendingBridgeClaim(rawValue, now)) claims.push({ key, rawValue: rawValue as string });
  }
  return { authoritative: true, claims };
}

async function runWithPendingBridgeClaim<T>(
  actionKey: string,
  storage: PendingBridgeStorage,
  callback: () => T,
  settleMs = PENDING_CLAIM_SETTLE_MS,
  processFenceKey = actionKey,
): Promise<{ acquired: false } | { acquired: true; value: T }> {
  const now = Date.now();
  if ((activePendingClaims.get(processFenceKey) ?? 0) > now) return { acquired: false };

  const attemptId = createPendingBridgeAttemptId();
  const claimKey = getPendingBridgeClaimKey(actionKey, attemptId);
  const claimValue = JSON.stringify({ attemptId, expiresAt: now + PENDING_CLAIM_LIFETIME_MS });
  let wroteClaim = false;
  activePendingClaims.set(processFenceKey, now + PENDING_CLAIM_LIFETIME_MS);
  try {
    const beforeWrite = collectPendingBridgeClaims(actionKey, storage, now);
    if (!beforeWrite.authoritative) throw new PendingBridgeStorageUnavailableError();
    if (beforeWrite.claims.length > 0) return { acquired: false };

    try {
      storage.setItem(claimKey, claimValue);
      wroteClaim = storage.getItem(claimKey) === claimValue;
    } catch {
      throw new PendingBridgeStorageUnavailableError();
    }
    if (!wroteClaim) throw new PendingBridgeStorageUnavailableError();

    await delay(settleMs);
    const afterWrite = collectPendingBridgeClaims(actionKey, storage);
    if (!afterWrite.authoritative) throw new PendingBridgeStorageUnavailableError();
    const ownClaim = afterWrite.claims.find((claim) => claim.key === claimKey);
    const otherClaims = afterWrite.claims.filter((claim) => claim.key !== claimKey);
    if (
      !ownClaim
      || ownClaim.rawValue !== claimValue
      || storage.getItem(claimKey) !== claimValue
      || parsePendingBridgeClaim(claimValue) === null
      || (activePendingClaims.get(processFenceKey) ?? 0) <= Date.now()
      || otherClaims.length > 0
    ) {
      return { acquired: false };
    }

    // No await is permitted inside the callback: the live immutable claim is
    // the fence that makes the following storage compare/write indivisible to
    // every cooperating tab and component.
    return { acquired: true, value: callback() };
  } finally {
    activePendingClaims.delete(processFenceKey);
    if (wroteClaim) {
      try {
        if (storage.getItem(claimKey) === claimValue) storage.removeItem(claimKey);
      } catch {
        // Never remove a value that another owner replaced; this claim expires.
      }
    }
  }
}

async function withPendingBridgeAdmission<T>(
  actionKey: string,
  storage: PendingBridgeStorage,
  callback: () => T,
  settleMs?: number,
  processFenceKey?: string,
): Promise<{ acquired: false } | { acquired: true; value: T }> {
  const run = () => runWithPendingBridgeClaim(
    actionKey,
    storage,
    callback,
    settleMs,
    processFenceKey,
  );
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    const lockName = `${PENDING_STORAGE_PREFIX}:${getPendingBridgeScope(actionKey)}`;
    return navigator.locks.request(lockName, { ifAvailable: true }, (lock) => (
      lock ? run() : Promise.resolve({ acquired: false } as const)
    ));
  }
  return run();
}

function padPendingBridgeReservation<T extends PendingBridgeReservation>(reservation: T): T {
  const unpadded = { ...reservation, reservationPadding: '' };
  const baseSize = JSON.stringify(unpadded).length;
  return {
    ...unpadded,
    reservationPadding: 'x'.repeat(
      Math.max(0, PENDING_RECORD_MAX_SIZE - baseSize - 64),
    ),
  } as T;
}

function createPendingBridgeReservation({
  actionKey,
  attemptId = createPendingBridgeAttemptId(),
  createdAt = Date.now(),
  requestKey,
  requestedAction,
}: {
  actionKey: string;
  attemptId?: string;
  createdAt?: number;
  requestKey: string;
  requestedAction: string;
}): PendingBridgeReservation {
  return padPendingBridgeReservation<PendingBridgeReservation>({
    version: 2,
    kind: 'reservation',
    actionKey,
    attemptId,
    requestKey,
    requestedAction,
    createdAt,
    phase: 'preparing',
    reservationPadding: '',
  });
}

export async function acquirePendingBridgeReservation({
  actionKey,
  requestKey,
  requestedAction,
  storage = getBrowserPendingBridgeStorage(),
  attemptId,
  createdAt,
  settleMs,
  processFenceKey,
}: {
  actionKey: string;
  requestKey: string;
  requestedAction: string;
  storage?: PendingBridgeStorage | null;
  /** Deterministic smoke-test seam. */
  attemptId?: string;
  /** Deterministic smoke-test seam. */
  createdAt?: number;
  /** Deterministic smoke-test seam. */
  settleMs?: number;
  /** Deterministic smoke-test seam for independent tab memory. */
  processFenceKey?: string;
}): Promise<PendingBridgeReservationResult> {
  if (!canDurablyPersistPendingBridgeRecords(storage)) {
    throw new PendingBridgeStorageUnavailableError();
  }

  const admitted = await withPendingBridgeAdmission(
    actionKey,
    storage as PendingBridgeStorage,
    () => {
      const durableStorage = storage as PendingBridgeStorage;
      const scan = scanPendingBridgeRecords(actionKey, durableStorage);
      if (!scan.authoritative) throw new PendingBridgeStorageUnavailableError();
      const activeRecord = scan.records.find((record) => isPendingBridgeRecordActive(record)) ?? null;
      if (activeRecord) {
        return { acquired: false, blocker: activeRecord, reason: 'active-record' } as const;
      }

      // Only stale pre-wallet preparation records can be inactive. Prune each
      // one by exact value while the immutable admission claim is held, so
      // repeated tab crashes cannot accumulate padded 4 KB records until
      // localStorage quota permanently blocks every future bridge action.
      for (const staleRecord of scan.records) {
        const staleKey = getPendingBridgeRecordKey(staleRecord);
        const expected = JSON.stringify(staleRecord);
        if (durableStorage.getItem(staleKey) !== expected) {
          throw new PendingBridgeStorageUnavailableError();
        }
        durableStorage.removeItem(staleKey);
        if (durableStorage.getItem(staleKey) !== null) {
          throw new PendingBridgeStorageUnavailableError();
        }
      }

      const reservation = createPendingBridgeReservation({
        actionKey,
        attemptId,
        createdAt,
        requestKey,
        requestedAction,
      });
      const storageKey = getPendingBridgeRecordKey(reservation);
      const serialized = JSON.stringify(reservation);
      try {
        durableStorage.setItem(storageKey, serialized);
        if (durableStorage.getItem(storageKey) !== serialized) {
          throw new PendingBridgeStorageUnavailableError();
        }
      } catch (error) {
        if (error instanceof PendingBridgeStorageUnavailableError) throw error;
        throw new PendingBridgeStorageUnavailableError();
      }
      dispatchPendingBridgeChange(actionKey, reservation);
      return { acquired: true, reservation } as const;
    },
    settleMs,
    processFenceKey,
  );

  if (!admitted.acquired) {
    return {
      acquired: false,
      blocker: loadPendingBridgeRecord(actionKey, storage),
      reason: 'contended',
    };
  }
  return admitted.value;
}

export async function markPendingBridgeWalletRequest(
  reservation: PendingBridgeReservation,
  metadata: PendingBridgeWalletMetadata,
  storage = getBrowserPendingBridgeStorage(),
  settleMs?: number,
): Promise<PendingBridgeWalletReservation | null> {
  if (!storage || reservation.phase !== 'preparing') return null;
  const admitted = await withPendingBridgeAdmission(
    reservation.actionKey,
    storage,
    () => {
      const active = getActivePendingBridgeRecord(reservation.actionKey, storage);
      if (!active.authoritative) throw new PendingBridgeStorageUnavailableError();
      if (
        !active.record
        || active.record.kind !== 'reservation'
        || active.record.attemptId !== reservation.attemptId
        || active.record.phase !== 'preparing'
        || Date.now() - active.record.createdAt >= PENDING_BRIDGE_PREPARATION_STALE_MS
      ) {
        return null;
      }
      const key = getPendingBridgeRecordKey(reservation);
      const expected = JSON.stringify(reservation);
      if (storage.getItem(key) !== expected) return null;
      const walletPending = padPendingBridgeReservation<PendingBridgeWalletReservation>({
        ...reservation,
        ...metadata,
        phase: 'wallet-pending',
      });
      const serialized = JSON.stringify(walletPending);
      storage.setItem(key, serialized);
      if (storage.getItem(key) !== serialized) throw new PendingBridgeStorageUnavailableError();
      dispatchPendingBridgeChange(reservation.actionKey, walletPending);
      return walletPending;
    },
    settleMs,
  );
  return admitted.acquired ? admitted.value : null;
}

export async function finalizePendingBridgeReservation(
  reservation: PendingBridgeWalletReservation,
  action: PendingBridgeAction,
  storage = getBrowserPendingBridgeStorage(),
  settleMs?: number,
): Promise<boolean> {
  if (
    !storage
    || reservation.phase !== 'wallet-pending'
    || action.kind !== 'submitted'
    || action.actionKey !== reservation.actionKey
    || action.attemptId !== reservation.attemptId
    || action.requestKey !== reservation.requestKey
    || action.requestedAction !== reservation.requestedAction
  ) {
    return false;
  }
  const admitted = await withPendingBridgeAdmission(
    reservation.actionKey,
    storage,
    () => {
      const key = getPendingBridgeRecordKey(reservation);
      const expected = JSON.stringify(reservation);
      const serialized = JSON.stringify(action);
      if (serialized.length > PENDING_RECORD_MAX_SIZE || storage.getItem(key) !== expected) return false;
      storage.setItem(key, serialized);
      if (storage.getItem(key) !== serialized) return false;
      dispatchPendingBridgeChange(action.actionKey, action);
      return true;
    },
    settleMs,
  );
  return admitted.acquired && admitted.value;
}

/**
 * Recover a wallet request that may have broadcast before its signature was
 * returned to the page. A successful signature is promoted to the normal
 * submitted lifecycle. Absence is actionable only after blockhash expiry and
 * only when both the precomputed outgoing account and its signature history
 * were read authoritatively.
 */
export async function recoverPendingBridgeWalletRequest(
  reservation: PendingBridgeReservation,
  connection: Pick<
    Connection,
    'getAccountInfo' | 'getBlockHeight' | 'getSignaturesForAddress'
  >,
  storage = getBrowserPendingBridgeStorage(),
): Promise<PendingBridgeWalletRecoveryResult> {
  if (
    reservation.phase !== 'wallet-pending'
    || typeof reservation.outgoingMessageAddress !== 'string'
    || typeof reservation.implicitSetup !== 'boolean'
    || typeof reservation.twinAddress !== 'string'
    || typeof reservation.recentBlockhash !== 'string'
    || typeof reservation.lastValidBlockHeight !== 'number'
  ) {
    return { status: 'pending', reason: 'ambiguous' };
  }
  const walletPending = reservation as PendingBridgeWalletReservation;
  let outgoingPublicKey: PublicKey;
  try {
    outgoingPublicKey = new PublicKey(walletPending.outgoingMessageAddress);
  } catch {
    return { status: 'pending', reason: 'ambiguous' };
  }

  const [accountResult, signaturesResult, blockHeightResult] = await Promise.allSettled([
    connection.getAccountInfo(outgoingPublicKey, 'finalized'),
    connection.getSignaturesForAddress(outgoingPublicKey, { limit: 10 }, 'finalized'),
    connection.getBlockHeight('finalized'),
  ]);
  const signatures = signaturesResult.status === 'fulfilled' ? signaturesResult.value : null;
  const landedSignature = signatures?.find((entry) => entry.err === null)
    ?? signatures?.[0]
    ?? null;

  if (landedSignature) {
    const submittedAction: PendingBridgeAction = {
      version: 2,
      kind: 'submitted',
      actionKey: walletPending.actionKey,
      attemptId: walletPending.attemptId,
      requestKey: walletPending.requestKey,
      requestedAction: walletPending.requestedAction,
      createdAt: Date.now(),
      signature: landedSignature.signature,
      outgoingMessageAddress: walletPending.outgoingMessageAddress,
      implicitSetup: walletPending.implicitSetup,
      solanaConfirmed: landedSignature.err === null
        && (landedSignature.confirmationStatus === 'confirmed'
          || landedSignature.confirmationStatus === 'finalized'),
      twinAddress: walletPending.twinAddress,
      recentBlockhash: walletPending.recentBlockhash,
      lastValidBlockHeight: walletPending.lastValidBlockHeight,
    };
    if (await finalizePendingBridgeReservation(walletPending, submittedAction, storage)) {
      return { status: 'submitted', action: submittedAction };
    }
    const stored = loadPendingBridgeAction(walletPending.actionKey, storage);
    if (stored?.attemptId === walletPending.attemptId) {
      return { status: 'submitted', action: stored };
    }
    return { status: 'pending', reason: 'ambiguous' };
  }

  const outgoingAccountExists = accountResult.status === 'fulfilled' && accountResult.value !== null;
  if (outgoingAccountExists) {
    return { status: 'pending', reason: 'landed-without-signature' };
  }

  const absenceIsAuthoritative = accountResult.status === 'fulfilled'
    && signaturesResult.status === 'fulfilled'
    && accountResult.value === null
    && signaturesResult.value.length === 0;
  if (
    absenceIsAuthoritative
    && blockHeightResult.status === 'fulfilled'
    && blockHeightResult.value > walletPending.lastValidBlockHeight
  ) {
    const released = await releasePendingBridgeReservation(walletPending, storage);
    return released
      ? { status: 'cleared', reason: 'expired-absent' }
      : { status: 'pending', reason: 'ambiguous' };
  }

  if (
    absenceIsAuthoritative
    && blockHeightResult.status === 'fulfilled'
    && blockHeightResult.value <= walletPending.lastValidBlockHeight
  ) {
    return { status: 'pending', reason: 'unexpired' };
  }
  return { status: 'pending', reason: 'ambiguous' };
}

export async function replacePendingBridgeAction(
  expected: PendingBridgeAction,
  action: PendingBridgeAction,
  storage = getBrowserPendingBridgeStorage(),
  settleMs?: number,
): Promise<boolean> {
  if (
    !storage
    || action.actionKey !== expected.actionKey
    || action.attemptId !== expected.attemptId
    || action.kind !== 'submitted'
  ) {
    return false;
  }
  const admitted = await withPendingBridgeAdmission(
    expected.actionKey,
    storage,
    () => {
      const key = getPendingBridgeRecordKey(expected);
      const expectedRaw = JSON.stringify(expected);
      const serialized = JSON.stringify(action);
      if (serialized.length > PENDING_RECORD_MAX_SIZE || storage.getItem(key) !== expectedRaw) return false;
      storage.setItem(key, serialized);
      if (storage.getItem(key) !== serialized) return false;
      dispatchPendingBridgeChange(action.actionKey, action);
      return true;
    },
    settleMs,
  );
  return admitted.acquired && admitted.value;
}

async function removePendingBridgeRecord(
  record: PendingBridgeRecord,
  storage = getBrowserPendingBridgeStorage(),
  settleMs?: number,
): Promise<boolean> {
  if (!storage) return false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const admitted = await withPendingBridgeAdmission(
      record.actionKey,
      storage,
      () => {
        const key = getPendingBridgeRecordKey(record);
        const expected = JSON.stringify(record);
        if (storage.getItem(key) !== expected) return false;
        storage.removeItem(key);
        if (storage.getItem(key) !== null) return false;
        dispatchPendingBridgeChange(record.actionKey, null);
        return true;
      },
      settleMs,
    );
    if (admitted.acquired) return admitted.value;
    if (attempt < 2) await delay((settleMs ?? PENDING_CLAIM_SETTLE_MS) + 10);
  }
  return false;
}

export function releasePendingBridgeReservation(
  reservation: PendingBridgeReservation,
  storage = getBrowserPendingBridgeStorage(),
  settleMs?: number,
): Promise<boolean> {
  return removePendingBridgeRecord(reservation, storage, settleMs);
}

export function clearPendingBridgeAction(
  action: PendingBridgeAction,
  storage = getBrowserPendingBridgeStorage(),
  settleMs?: number,
): Promise<boolean> {
  return removePendingBridgeRecord(action, storage, settleMs);
}
