import { keccak256, stringToHex, type Hex } from "viem";

export type PendingEvmExecutionMethod = "batch" | "direct";
export type PendingEvmPhase = "hard" | "stale";

export type PendingEvmStorage = {
  getItem: (key: string) => string | null;
  key?: (index: number) => string | null;
  length?: number;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
};

export type PendingEvmCall = {
  address?: `0x${string}`;
  data?: `0x${string}`;
  to?: `0x${string}`;
  value?: bigint;
};

export type PendingEvmIntentIdentity = {
  accountAddress: string;
  chainId: number;
  intentKey: string;
};

export type PendingEvmRegistryIdentity = Omit<PendingEvmIntentIdentity, "intentKey">;

export type PendingEvmProof =
  | { hash: Hex; kind: "hash" }
  | { hash?: Hex; id: string; kind: "calls" }
  | { kind: "reservation" };

export type PendingEvmRecord = {
  accountAddress: string;
  attemptId: string;
  callsDigest: Hex;
  chainId: number;
  connectorId?: string;
  intentDigest: Hex;
  method: PendingEvmExecutionMethod;
  proof: PendingEvmProof;
  reservationPadding?: string;
  submittedAt: number;
  version: 2;
};

export type PendingEvmChange = {
  attemptId?: string;
  key: string;
  operation: "acknowledge" | "claim" | "prune" | "release" | "remove" | "write";
};

/**
 * How long an in-flight wallet submission may run before it is abandoned. This
 * has to cover a player who leaves a wallet prompt open, so it stays generous.
 */
export const PENDING_EVM_HARD_LOCK_MS = 30 * 60 * 1_000;

/**
 * How long a *stuck* record stays locked before the player may say "I checked
 * my wallet, nothing was sent" and unlock the app.
 *
 * These used to be the same 30 minutes, which meant any ambiguous transport
 * failure froze every transaction button in the app for half an hour with no
 * recourse — the UI told the player to check their wallet activity and then
 * gave them no way to act on what they found.
 *
 * A record carrying a hash or calls id keeps the long lock: there is something
 * concrete to watch, monitoring can still resolve it on its own, and a late
 * confirmation is a real possibility. A proofless reservation has neither, so
 * waiting adds no information the player does not already have — only the
 * player can resolve it, and on Base a genuine broadcast settles long inside
 * this window.
 */
export const PENDING_EVM_AMBIGUOUS_ACK_LOCK_MS = 5 * 60 * 1_000;

/** Marker the RPC proxy stamps on rejections it never forwarded upstream. */
export const PENDING_EVM_PROXY_NOT_FORWARDED_MARKER = "PIXOTCHI_PROXY_NOT_FORWARDED";
export const PENDING_EVM_MAX_RECORD_SIZE = 4_096;
export const PENDING_EVM_STALE_MESSAGE =
  "This transaction is still unconfirmed. Check your wallet before allowing a new transaction.";

const PENDING_EVM_STORAGE_PREFIX = "pixotchi:pending-evm:v2";
const PENDING_EVM_RECORD_PREFIX = `${PENDING_EVM_STORAGE_PREFIX}:record`;
const PENDING_EVM_LEASE_PREFIX = `${PENDING_EVM_STORAGE_PREFIX}:lease`;
const PENDING_EVM_CHANGE_EVENT = "pixotchi:pending-evm-change";
const PENDING_EVM_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const PENDING_EVM_MONITOR_LEASE_MS = 20_000;
const PENDING_EVM_MONITOR_HEARTBEAT_MS = 7_000;
const PENDING_EVM_SUBMISSION_LEASE_MS = 2 * 60 * 1_000;
const PENDING_EVM_SUBMISSION_HEARTBEAT_MS = 25_000;
const PENDING_EVM_STORAGE_SNAPSHOT_MAX_PASSES = 8;
const pendingMemoryRecords = new Map<string, string>();
const pendingMemoryOnlyKeys = new Set<string>();
const activeSubmissionLeases = new Map<string, number>();
const activeMonitorLeases = new Map<string, number>();

export class PendingEvmStaleError extends Error {
  constructor() {
    super(PENDING_EVM_STALE_MESSAGE);
    this.name = "PendingEvmStaleError";
  }
}

export class PendingEvmStorageUnavailableError extends Error {
  constructor() {
    super(
      "Safe transaction tracking requires browser storage. Enable site storage, then try again.",
    );
    this.name = "PendingEvmStorageUnavailableError";
  }
}

/**
 * Errors that prove the wallet/RPC rejected a request before returning an
 * on-chain hash or calls id. These may safely release a proofless reservation;
 * transport/time-out/provider errors deliberately remain ambiguous and locked.
 */
export function isDefinitivePendingEvmPreSubmissionError(error: unknown): boolean {
  const hasDefinitiveMessage = (message: string) => (
    // Our own RPC proxy stamps the rejections it makes before forwarding
    // anything upstream. Those provably never reached a node, so they are
    // pre-submission facts rather than broadcast ambiguity.
    message.includes(PENDING_EVM_PROXY_NOT_FORWARDED_MARKER.toLowerCase())
    || /user\s+(?:rejected|denied|cancell?ed)|request\s+(?:rejected|cancell?ed)\s+by\s+(?:the\s+)?user|user\s+rejected\s+the\s+request/.test(message)
    || message.includes("insufficient funds")
    || message.includes("chain mismatch")
    || message.includes("unsupported chain")
    || message.includes("invalid address")
    || message.includes("invalid params")
  );
  const nodes: Array<{
    code?: number | string;
    message: string;
    name: string;
  }> = [];
  const visited = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && !visited.has(current); depth += 1) {
    visited.add(current);
    if (typeof current === "string") {
      nodes.push({ code: undefined, message: current.toLowerCase(), name: "" });
      break;
    }
    if (typeof current !== "object") break;
    const typed = current as {
      cause?: unknown;
      code?: number | string;
      message?: unknown;
      name?: unknown;
      shortMessage?: unknown;
    };
    nodes.push({
      code: typed.code,
      message: [typed.shortMessage, typed.message]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .toLowerCase(),
      name: typeof typed.name === "string" ? typed.name.toLowerCase() : "",
    });
    current = typed.cause;
  }

  // A proxy rejection is proof, not a hint, so it outranks the ambiguity
  // heuristic below (a rate-limit refusal reads as "network-ish" but was never
  // forwarded).
  if (nodes.some(({ message }) => (
    message.includes(PENDING_EVM_PROXY_NOT_FORWARDED_MARKER.toLowerCase())
  ))) return true;

  // Explicit transport/broadcast ambiguity always wins over a nested or
  // message-level rejection label. Some providers report "request rejected"
  // only after forwarding the request and losing the response.
  if (nodes.some(({ message, name }) => (
    /timed?\s*out|timeout|network|fetch failed|connection|disconnected|response (?:was )?lost|broadcast[^.]*unknown|unknown[^.]*broadcast|rate limit|\b429\b|service unavailable|temporarily unavailable|gateway/.test(message)
    || name.includes("timeout")
    || name.includes("httprequest")
    || name.includes("websocketrequest")
  ))) return false;

  return nodes.some(({ code, message, name }) => (
      code === 4001
      || code === "4001"
      || code === 3
      || code === -32602
      || code === "ACTION_REJECTED"
      // A refused method cannot have been executed: the provider rejected it
      // outright rather than acting on it. transaction-kit already recovers
      // from this through its batch->direct fallback, but every other caller
      // (the swap panel's submitTrackedAttempt) went straight to "ambiguous"
      // and kept the reservation, locking the wallet over a request that
      // provably never reached a node.
      || code === -32601
      || code === "-32601"
      || code === -32004
      || code === "-32004"
      || code === 4200
      || code === "4200"
      || name.includes("methodnotfound")
      || name.includes("methodnotsupported")
      || name.includes("unsupportedprovidermethod")
      || name.includes("userrejected")
      || name.includes("insufficientfunds")
      || name.includes("chainmismatch")
      || name.includes("unsupportedchain")
      || name.includes("invalidaddress")
      || name.includes("invalidparams")
      || name.includes("contractfunctionreverted")
      || name.includes("executionreverted")
      || hasDefinitiveMessage(message)
  ));
}

/**
 * Proves that wallet_sendCalls itself is unsupported, so a proofless batch
 * reservation may be released before falling back to a direct transaction.
 * Message-only failures are intentionally insufficient: providers often wrap
 * a forwarded request timeout with the method name, which is broadcast-ambiguous.
 */
export function isDefinitiveUnsupportedEvmBatchError(error: unknown): boolean {
  const nodes: Array<{
    code?: number | string;
    message: string;
    name: string;
  }> = [];
  const visited = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && !visited.has(current); depth += 1) {
    visited.add(current);
    if (typeof current === "string") {
      nodes.push({ code: undefined, message: current.toLowerCase(), name: "" });
      break;
    }
    if (typeof current !== "object") break;
    const typed = current as {
      cause?: unknown;
      code?: number | string;
      message?: unknown;
      name?: unknown;
      shortMessage?: unknown;
    };
    nodes.push({
      code: typed.code,
      message: [typed.shortMessage, typed.message]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .toLowerCase(),
      name: typeof typed.name === "string" ? typed.name.toLowerCase() : "",
    });
    current = typed.cause;
  }

  const hasAmbiguousTransportEvidence = nodes.some(({ message, name }) => (
    /timed?\s*out|timeout|network|fetch failed|connection|disconnected|rate limit|\b429\b|service unavailable|temporarily unavailable|gateway/.test(message)
    || name.includes("timeout")
    || name.includes("httprequest")
    || name.includes("websocketrequest")
  ));
  if (hasAmbiguousTransportEvidence) return false;

  if (nodes.some(({ code, name }) => (
    code === -32601
    || code === "-32601"
    || code === -32004
    || code === "-32004"
    || code === 4200
    || code === "4200"
    || name.includes("methodnotfound")
    || name.includes("methodnotsupported")
    || name.includes("unsupportedprovidermethod")
  ))) return true;

  // Last resort for wallets that refuse the method with a bare, uncoded Error.
  // Deliberately narrow: the message must name wallet_sendCalls *and* say it is
  // unsupported, and we only get here with no transport-ambiguity evidence at
  // all. A forwarded request that timed out mentioning the method name is
  // already excluded above, which is the case this rule must not swallow.
  //
  // Without it, such a wallet can never batch and never falls back: the batch
  // reservation is kept as "might have been broadcast" and every transaction
  // button stays locked, even though nothing ever reached a node.
  return nodes.some(({ message }) => (
    message.includes("wallet_sendcalls")
    && /\b(?:un|not )supported|does\s+not\s+support|no\s+support\s+for|cannot\s+(?:be\s+)?(?:handle|support)/.test(message)
  ));
}

function isHex32(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
}

function normalizeAddress(address: string) {
  return address.toLowerCase();
}

function isRegistryIdentity(identity: PendingEvmRegistryIdentity) {
  return /^0x[0-9a-f]{40}$/i.test(identity.accountAddress)
    && Number.isSafeInteger(identity.chainId)
    && identity.chainId > 0;
}

export function createPendingEvmScope(calls: PendingEvmCall[]) {
  return JSON.stringify(
    calls.map((call) => ({
      data: call.data?.toLowerCase() ?? null,
      to: (call.to ?? call.address)?.toLowerCase() ?? null,
      value: (call.value ?? BigInt(0)).toString(10),
    })),
  );
}

export function createPendingEvmCallsDigest(calls: PendingEvmCall[]) {
  return keccak256(stringToHex(createPendingEvmScope(calls)));
}

export function getPendingEvmIntentDigest(intentKey: string) {
  return keccak256(stringToHex(intentKey));
}

export function getPendingEvmStorageKey(
  identity: PendingEvmIntentIdentity | Pick<PendingEvmRecord, "accountAddress" | "chainId" | "intentDigest">,
) {
  const intentDigest = "intentDigest" in identity
    ? identity.intentDigest
    : getPendingEvmIntentDigest(identity.intentKey);
  return [
    PENDING_EVM_RECORD_PREFIX,
    identity.chainId,
    normalizeAddress(identity.accountAddress),
    intentDigest,
  ].join(":");
}

function getPendingEvmRecordStorageKey(record: PendingEvmRecord) {
  return `${getPendingEvmStorageKey(record)}:attempt:${keccak256(stringToHex(record.attemptId))}`;
}

function getPendingEvmIntentRecordPrefix(identity: PendingEvmIntentIdentity) {
  return `${getPendingEvmStorageKey(identity)}:attempt:`;
}

function getRegistryPrefix(identity: PendingEvmRegistryIdentity) {
  return [
    PENDING_EVM_RECORD_PREFIX,
    identity.chainId,
    normalizeAddress(identity.accountAddress),
    "",
  ].join(":");
}

function getSubmissionLeaseKey(identity: PendingEvmRegistryIdentity) {
  return [
    PENDING_EVM_LEASE_PREFIX,
    identity.chainId,
    normalizeAddress(identity.accountAddress),
  ].join(":");
}

function getMonitorLeaseKey(record: PendingEvmRecord) {
  return `${PENDING_EVM_STORAGE_PREFIX}:monitor:${record.chainId}:${record.accountAddress}:${record.attemptId}`;
}

function getLeaseClaimPrefix(logicalKey: string) {
  return `${logicalKey}:claim:`;
}

function getLeaseClaimKey(logicalKey: string, token: string) {
  return `${getLeaseClaimPrefix(logicalKey)}${token}`;
}

type PendingEvmLease = { expiresAt: number; token: string };

function parsePendingEvmLease(rawValue: string | null, now = Date.now()): PendingEvmLease | null {
  if (!rawValue || rawValue.length > 512) return null;
  try {
    const value = JSON.parse(rawValue) as Partial<PendingEvmLease>;
    if (
      typeof value.token !== "string"
      || value.token.length < 8
      || value.token.length > 128
      || typeof value.expiresAt !== "number"
      || !Number.isFinite(value.expiresAt)
      || value.expiresAt <= now
      || value.expiresAt > now + PENDING_EVM_HARD_LOCK_MS
    ) {
      return null;
    }
    return { expiresAt: value.expiresAt, token: value.token };
  } catch {
    return null;
  }
}

type PendingEvmStorageKeyCapture = {
  complete: boolean;
  failed: boolean;
  keys: string[];
};

type PendingEvmStableStorageEntries = {
  authoritative: boolean;
  keys: Set<string>;
  values: Map<string, string>;
};

function capturePendingEvmStorageKeys(
  storage: PendingEvmStorage,
): PendingEvmStorageKeyCapture {
  const keys: string[] = [];
  try {
    const keyAt = storage.key;
    const startLength = storage.length;
    if (
      typeof keyAt !== "function"
      || typeof startLength !== "number"
      || !Number.isSafeInteger(startLength)
      || startLength < 0
    ) {
      return { complete: false, failed: true, keys };
    }

    const seen = new Set<string>();
    for (let index = 0; index < startLength; index += 1) {
      const key = keyAt.call(storage, index);
      if (key === null || seen.has(key)) {
        return { complete: false, failed: false, keys };
      }
      seen.add(key);
      keys.push(key);
    }
    const endLength = storage.length;
    if (endLength !== startLength || seen.size !== startLength) {
      return { complete: false, failed: false, keys };
    }
    return { complete: true, failed: false, keys: keys.sort() };
  } catch {
    return { complete: false, failed: true, keys };
  }
}

function samePendingEvmKeySet(left: string[], right: string[]) {
  return left.length === right.length
    && left.every((key, index) => key === right[index]);
}

function collectStablePendingEvmStorageEntries(
  storage: PendingEvmStorage | null,
  isCandidate: (key: string) => boolean,
): PendingEvmStableStorageEntries {
  const emptyResult = () => ({
    authoritative: false,
    keys: new Set<string>(),
    values: new Map<string, string>(),
  });
  if (!storage) return emptyResult();

  const observedCandidates = new Set<string>();
  let previousCompleteKeys: string[] | null = null;
  for (let pass = 0; pass < PENDING_EVM_STORAGE_SNAPSHOT_MAX_PASSES; pass += 1) {
    const capture = capturePendingEvmStorageKeys(storage);
    for (const key of capture.keys) {
      if (isCandidate(key)) observedCandidates.add(key);
    }
    if (capture.failed) return { ...emptyResult(), keys: observedCandidates };
    if (!capture.complete) {
      previousCompleteKeys = null;
      continue;
    }
    if (
      previousCompleteKeys === null
      || !samePendingEvmKeySet(previousCompleteKeys, capture.keys)
    ) {
      previousCompleteKeys = capture.keys;
      continue;
    }

    const values = new Map<string, string>();
    let candidateDisappeared = false;
    for (const key of observedCandidates) {
      let rawValue: string | null;
      try {
        rawValue = storage.getItem(key);
      } catch {
        return { ...emptyResult(), keys: observedCandidates };
      }
      if (rawValue === null) {
        candidateDisappeared = true;
        break;
      }
      values.set(key, rawValue);
    }
    if (candidateDisappeared) {
      // A concurrent deletion can be legitimate, but it also shifts Storage
      // indexes. Start a fresh bounded snapshot before authorizing a send.
      observedCandidates.clear();
      previousCompleteKeys = null;
      continue;
    }

    // Revalidate the complete key set after reading candidate values. This
    // catches insertion, deletion, or same-length replacement during reads.
    const validation = capturePendingEvmStorageKeys(storage);
    for (const key of validation.keys) {
      if (isCandidate(key)) observedCandidates.add(key);
    }
    if (validation.failed) return { ...emptyResult(), keys: observedCandidates };
    if (!validation.complete) {
      previousCompleteKeys = null;
      continue;
    }
    if (!samePendingEvmKeySet(capture.keys, validation.keys)) {
      previousCompleteKeys = validation.keys;
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
        return { ...emptyResult(), keys: observedCandidates };
      }
    }
    if (valuesChanged) {
      // A heartbeat/finalization can update a value without changing its key.
      // Re-read the complete candidate set before parsing or pruning it.
      previousCompleteKeys = validation.keys;
      continue;
    }
    return { authoritative: true, keys: observedCandidates, values };
  }
  return { ...emptyResult(), keys: observedCandidates };
}

function compareAndDeletePendingEvmStorageValue(
  storage: PendingEvmStorage,
  key: string,
  expectedRawValue: string,
) {
  try {
    if (storage.getItem(key) !== expectedRawValue) return false;
    storage.removeItem(key);
    return storage.getItem(key) === null;
  } catch {
    return false;
  }
}

function collectStoredLeases(
  storage: PendingEvmStorage | null,
  logicalKey: string,
  now = Date.now(),
) {
  const leases: Array<{ expiresAt: number; key: string }> = [];
  if (!storage) return { authoritative: false, leases };
  const claimPrefix = getLeaseClaimPrefix(logicalKey);
  const snapshot = collectStablePendingEvmStorageEntries(
    storage,
    (key) => key === logicalKey || key.startsWith(claimPrefix),
  );
  if (!snapshot.authoritative) return { authoritative: false, leases };
  try {
    // Read-only migration support for the earlier canonical lease shape.
    const canonicalRaw = snapshot.values.get(logicalKey) ?? null;
    const canonicalLease = parsePendingEvmLease(canonicalRaw, now);
    if (canonicalLease) {
      leases.push({ expiresAt: canonicalLease.expiresAt, key: logicalKey });
    }

    for (const key of snapshot.keys) {
      if (!key.startsWith(claimPrefix)) continue;
      const rawValue = snapshot.values.get(key) ?? null;
      const lease = parsePendingEvmLease(rawValue, now);
      if (lease) leases.push({ expiresAt: lease.expiresAt, key });
    }
    // Shared claim keys are owner-cleaned. Never destructively prune a value
    // another document may be renewing; confirm the parsed snapshot is still
    // current before using it for admission.
    for (const [key, rawValue] of snapshot.values) {
      if (storage.getItem(key) !== rawValue) {
        return { authoritative: false, leases };
      }
    }
    return { authoritative: true, leases };
  } catch {
    return { authoritative: false, leases };
  }
}

function getStoredLeaseExpiresAt(
  storage: PendingEvmStorage | null,
  logicalKey: string,
  now = Date.now(),
) {
  const { leases } = collectStoredLeases(storage, logicalKey, now);
  return leases.reduce<number | null>(
    (latest, lease) => latest === null ? lease.expiresAt : Math.max(latest, lease.expiresAt),
    null,
  );
}

export function getPendingEvmSubmissionLeaseExpiresAt(
  storage: PendingEvmStorage | null,
  registry: PendingEvmRegistryIdentity,
  now = Date.now(),
) {
  const key = getSubmissionLeaseKey(registry);
  const expiresAt = Math.max(
    activeSubmissionLeases.get(key) ?? 0,
    getStoredLeaseExpiresAt(storage, key, now) ?? 0,
  ) || null;
  schedulePendingEvmLeaseExpiry(storage, key, expiresAt);
  return expiresAt;
}

export function getPendingEvmMonitorLeaseExpiresAt(
  storage: PendingEvmStorage | null,
  record: PendingEvmRecord,
  now = Date.now(),
) {
  const key = getMonitorLeaseKey(record);
  const expiresAt = Math.max(
    activeMonitorLeases.get(key) ?? 0,
    getStoredLeaseExpiresAt(storage, key, now) ?? 0,
  ) || null;
  schedulePendingEvmLeaseExpiry(storage, key, expiresAt);
  return expiresAt;
}

export function canDurablyPersistPendingEvmTransactions(storage: PendingEvmStorage | null) {
  if (!storage) return false;
  const key = `${PENDING_EVM_STORAGE_PREFIX}:probe:${createAttemptId()}`;
  // Reserve the maximum supported proof-record footprint, not just a tiny
  // token. This fails closed when localStorage is close to quota.
  const value = "x".repeat(PENDING_EVM_MAX_RECORD_SIZE + 512);
  let durable = false;
  try {
    storage.setItem(key, value);
    if (storage.getItem(key) !== value) return false;
    const keyAt = storage.key;
    const storageLength = storage.length;
    if (typeof keyAt !== "function" || typeof storageLength !== "number") return false;
    let discovered = false;
    for (let index = 0; index < storageLength; index += 1) {
      if (keyAt.call(storage, index) === key) {
        discovered = true;
        break;
      }
    }
    if (!discovered) return false;
    durable = true;
  } catch {
    durable = false;
  } finally {
    try {
      storage.removeItem(key);
    } catch {
      // The probe is deliberately best effort on restricted Storage objects.
    }
  }
  if (!durable) return false;
  try {
    return storage.getItem(key) === null;
  } catch {
    return false;
  }
}

export function getBrowserPendingEvmStorage(): PendingEvmStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function dispatchPendingEvmChange(change: PendingEvmChange) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PENDING_EVM_CHANGE_EVENT, { detail: change }));
}

function createAttemptId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createPendingEvmRecord({
  attemptId = createAttemptId(),
  callsDigest,
  connectorId,
  identity,
  method,
  proof,
  submittedAt = Date.now(),
}: {
  attemptId?: string;
  callsDigest: Hex;
  connectorId?: string;
  identity: PendingEvmIntentIdentity;
  method: PendingEvmExecutionMethod;
  proof: PendingEvmProof;
  submittedAt?: number;
}): PendingEvmRecord {
  const record: PendingEvmRecord = {
    accountAddress: normalizeAddress(identity.accountAddress),
    attemptId,
    callsDigest,
    chainId: identity.chainId,
    ...(connectorId ? { connectorId } : {}),
    intentDigest: getPendingEvmIntentDigest(identity.intentKey),
    method,
    proof,
    submittedAt,
    version: 2,
  };
  if (proof.kind === "reservation") {
    const baseSize = JSON.stringify(record).length;
    record.reservationPadding = "x".repeat(
      Math.max(0, PENDING_EVM_MAX_RECORD_SIZE - baseSize - 64),
    );
  }
  return record;
}

/**
 * How long this record blocks the wallet before the player may acknowledge it.
 * Proofless reservations use the short window; anything carrying a hash or
 * calls id keeps the full submission lock. See PENDING_EVM_AMBIGUOUS_ACK_LOCK_MS.
 */
export function getPendingEvmAckLockMs(
  record: Pick<PendingEvmRecord, "proof">,
): number {
  return record.proof?.kind === "reservation"
    ? PENDING_EVM_AMBIGUOUS_ACK_LOCK_MS
    : PENDING_EVM_HARD_LOCK_MS;
}

/** When this record becomes acknowledgeable, ignoring any live submission lease. */
export function getPendingEvmAckUnlockAt(
  record: Pick<PendingEvmRecord, "proof" | "submittedAt">,
): number {
  return record.submittedAt + getPendingEvmAckLockMs(record);
}

export function getPendingEvmPhase(
  record: Pick<PendingEvmRecord, "proof" | "submittedAt">,
  now = Date.now(),
): PendingEvmPhase {
  const ageMs = now - record.submittedAt;
  // A browser/system clock can move backwards after a proof is persisted.
  // Never discard that proof or let a future timestamp create an unbounded
  // hard lock; retain it and require the explicit stale acknowledgement path.
  if (
    record.submittedAt > now + PENDING_EVM_CLOCK_SKEW_MS
    || ageMs >= getPendingEvmAckLockMs(record)
  ) return "stale";
  return "hard";
}

function isStructurallyValidRecord(
  value: unknown,
  registry: PendingEvmRegistryIdentity,
): value is PendingEvmRecord {
  if (!value || typeof value !== "object" || !isRegistryIdentity(registry)) return false;
  const record = value as Partial<PendingEvmRecord>;
  const validProof = record.proof?.kind === "reservation"
    ? (
      typeof record.reservationPadding === "string"
      && record.reservationPadding.length <= PENDING_EVM_MAX_RECORD_SIZE
      && (record.method === "direct" || typeof record.connectorId === "string")
    )
    : record.method === "direct"
      ? record.proof?.kind === "hash" && isHex32(record.proof.hash)
      : record.method === "batch"
      && record.proof?.kind === "calls"
      && typeof record.proof.id === "string"
      && record.proof.id.trim() !== ""
      && record.proof.id.length <= 512
      && (record.proof.hash === undefined || isHex32(record.proof.hash))
      && typeof record.connectorId === "string"
      && record.connectorId.trim() !== ""
      && record.connectorId.length <= 128;

  return record.version === 2
    && record.accountAddress === normalizeAddress(registry.accountAddress)
    && record.chainId === registry.chainId
    && typeof record.attemptId === "string"
    && record.attemptId.length >= 8
    && record.attemptId.length <= 128
    && /^[A-Za-z0-9._-]+$/.test(record.attemptId)
    && isHex32(record.intentDigest)
    && isHex32(record.callsDigest)
    && (record.method === "batch" || record.method === "direct")
    && typeof record.submittedAt === "number"
    && Number.isFinite(record.submittedAt)
    && record.submittedAt > 0
    && validProof;
}

type PendingEvmStoredReadState = { authoritative: boolean };

function readStoredValue(
  storage: PendingEvmStorage | null,
  key: string,
  readState?: PendingEvmStoredReadState,
) {
  if (readState) readState.authoritative = false;
  if (storage) {
    try {
      const storedValue = storage.getItem(key);
      if (storedValue !== null) {
        pendingMemoryRecords.set(key, storedValue);
        pendingMemoryOnlyKeys.delete(key);
        if (readState) readState.authoritative = true;
        return storedValue;
      }
      if (!pendingMemoryOnlyKeys.has(key)) {
        // A successful null read is authoritative. In particular, do not
        // resurrect a record that another tab removed from localStorage.
        pendingMemoryRecords.delete(key);
        if (readState) readState.authoritative = true;
        return null;
      }
      const memoryOnlyValue = pendingMemoryRecords.get(key) ?? null;
      if (memoryOnlyValue !== null) {
        try {
          storage.setItem(key, memoryOnlyValue);
          if (storage.getItem(key) === memoryOnlyValue) {
            pendingMemoryOnlyKeys.delete(key);
            if (readState) readState.authoritative = true;
          }
        } catch {
          // Keep the in-memory proof until durable storage recovers.
        }
        return memoryOnlyValue;
      }
    } catch {
      // Fall through to the same-document memory mirror.
    }
  }
  return pendingMemoryRecords.get(key) ?? null;
}

function deleteRecordKey(
  storage: PendingEvmStorage | null,
  key: string,
  operation: PendingEvmChange["operation"],
  attemptId?: string,
  expectedRawValue?: string,
) {
  const isMemoryOnly = pendingMemoryOnlyKeys.has(key);
  if (storage) {
    try {
      if (expectedRawValue !== undefined) {
        const currentRawValue = storage.getItem(key);
        if (currentRawValue !== expectedRawValue) {
          if (!(isMemoryOnly && currentRawValue === null)) return false;
        } else if (!compareAndDeletePendingEvmStorageValue(storage, key, expectedRawValue)) {
          return false;
        }
      } else {
        storage.removeItem(key);
        if (storage.getItem(key) !== null) return false;
      }
    } catch {
      if (!isMemoryOnly) return false;
    }
  }
  pendingMemoryRecords.delete(key);
  pendingMemoryOnlyKeys.delete(key);
  dispatchPendingEvmChange({ attemptId, key, operation });
  return true;
}

function parseStoredRecord(
  storage: PendingEvmStorage | null,
  key: string,
  registry: PendingEvmRegistryIdentity,
  readState?: PendingEvmStoredReadState,
  rawRecordOverride?: string,
) {
  const rawRecord = rawRecordOverride === undefined
    ? readStoredValue(storage, key, readState)
    : rawRecordOverride;
  if (rawRecordOverride !== undefined && readState) readState.authoritative = true;
  if (!rawRecord) return null;
  if (rawRecord.length > PENDING_EVM_MAX_RECORD_SIZE) {
    if (readState) readState.authoritative = false;
    deleteRecordKey(storage, key, "prune", undefined, rawRecord);
    return null;
  }

  try {
    const record: unknown = JSON.parse(rawRecord);
    if (!isStructurallyValidRecord(record, registry)) {
      if (readState) readState.authoritative = false;
      deleteRecordKey(storage, key, "prune", undefined, rawRecord);
      return null;
    }
    const logicalKey = getPendingEvmStorageKey(record);
    if (key !== logicalKey && key !== getPendingEvmRecordStorageKey(record)) {
      if (readState) readState.authoritative = false;
      deleteRecordKey(storage, key, "prune", record.attemptId, rawRecord);
      return null;
    }
    pendingMemoryRecords.set(key, rawRecord);
    return record;
  } catch {
    if (readState) readState.authoritative = false;
    deleteRecordKey(storage, key, "prune", undefined, rawRecord);
    return null;
  }
}

export function readPendingEvmRecord(
  storage: PendingEvmStorage | null,
  identity: PendingEvmIntentIdentity,
) {
  const logicalKey = getPendingEvmStorageKey(identity);
  const physicalPrefix = getPendingEvmIntentRecordPrefix(identity);
  const { keys } = collectPendingEvmKeys(storage, physicalPrefix);
  // Read and prune the pre-attempt-key v2 shape as a migration path and to
  // keep malformed logical-key records from becoming permanent blockers.
  keys.add(logicalKey);
  const intentDigest = getPendingEvmIntentDigest(identity.intentKey);
  const records: PendingEvmRecord[] = [];
  for (const key of keys) {
    const record = parseStoredRecord(storage, key, identity);
    if (record?.intentDigest === intentDigest) records.push(record);
  }
  return records.sort((left, right) => (
    left.submittedAt - right.submittedAt
    || left.attemptId.localeCompare(right.attemptId)
  ))[0] ?? null;
}

function collectPendingEvmKeys(storage: PendingEvmStorage | null, prefix: string) {
  const keys = new Set<string>();
  for (const key of pendingMemoryRecords.keys()) {
    if (key.startsWith(prefix)) keys.add(key);
  }
  const snapshot = collectStablePendingEvmStorageEntries(
    storage,
    (key) => key.startsWith(prefix),
  );
  for (const key of snapshot.keys) keys.add(key);
  return {
    authoritative: snapshot.authoritative,
    keys,
    values: snapshot.values,
  };
}

export function listPendingEvmRecords(
  storage: PendingEvmStorage | null,
  registry: PendingEvmRegistryIdentity,
) {
  return scanPendingEvmRecords(storage, registry).records;
}

function scanPendingEvmRecords(
  storage: PendingEvmStorage | null,
  registry: PendingEvmRegistryIdentity,
) {
  if (!isRegistryIdentity(registry)) {
    return { authoritative: false, records: [] as PendingEvmRecord[] };
  }
  const prefix = getRegistryPrefix(registry);
  const {
    authoritative: keysAuthoritative,
    keys,
    values,
  } = collectPendingEvmKeys(storage, prefix);
  let readsAuthoritative = true;
  const recordsByAttempt = new Map<string, PendingEvmRecord>();
  for (const key of keys) {
    const readState: PendingEvmStoredReadState = { authoritative: false };
    const record = parseStoredRecord(
      storage,
      key,
      registry,
      readState,
      values.get(key),
    );
    // Memory fallback keeps the current document safe, but an unreadable
    // enumerated key cannot prove to another submission that the registry is
    // empty. Fail closed until every candidate can be read authoritatively.
    if (!readState.authoritative) readsAuthoritative = false;
    if (record && !recordsByAttempt.has(record.attemptId)) {
      recordsByAttempt.set(record.attemptId, record);
    }
  }
  const records = [...recordsByAttempt.values()];
  return {
    authoritative: keysAuthoritative && readsAuthoritative,
    records: records.sort((left, right) => left.submittedAt - right.submittedAt),
  };
}

export function listUnacknowledgedPendingEvmRecords(
  storage: PendingEvmStorage | null,
  registry: PendingEvmRegistryIdentity,
) {
  return listPendingEvmRecords(storage, registry);
}

export function hasUnacknowledgedPendingEvmRecord(
  storage: PendingEvmStorage | null,
  registry: PendingEvmRegistryIdentity,
) {
  return listUnacknowledgedPendingEvmRecords(storage, registry).length > 0;
}

export function getPendingEvmCompatibility(
  record: PendingEvmRecord,
  current: { callsDigest: Hex; connectorId?: string },
) {
  const callsMatch = record.callsDigest === current.callsDigest;
  const connectorMatch = record.method === "direct"
    || (typeof current.connectorId === "string" && record.connectorId === current.connectorId);
  // A stable intent key is authoritative. Calls can legitimately change after
  // reload (deadlines, game nonces, signatures); the digest remains useful for
  // integrity/debugging but must not block status-only proof recovery.
  return { callsMatch, connectorMatch, canResume: connectorMatch };
}

export function writePendingEvmRecord(
  storage: PendingEvmStorage | null,
  record: PendingEvmRecord,
) {
  // Attempts are physically immutable and independently keyed. An old monitor
  // can therefore delete only its own attempt, never a newer same-intent send.
  const key = getPendingEvmRecordStorageKey(record);
  const serializedRecord = JSON.stringify(record);
  if (serializedRecord.length > PENDING_EVM_MAX_RECORD_SIZE) return false;
  const existingRecord = readStoredValue(storage, key);
  if (existingRecord !== null && existingRecord !== serializedRecord) return false;
  pendingMemoryRecords.set(key, serializedRecord);
  let persisted = false;
  if (storage) {
    try {
      storage.setItem(key, serializedRecord);
      persisted = storage.getItem(key) === serializedRecord;
      if (persisted) pendingMemoryOnlyKeys.delete(key);
      else pendingMemoryOnlyKeys.add(key);
    } catch {
      // Same-document controllers still share the memory mirror and event.
      pendingMemoryOnlyKeys.add(key);
    }
  } else {
    pendingMemoryOnlyKeys.add(key);
  }
  dispatchPendingEvmChange({ attemptId: record.attemptId, key, operation: "write" });
  return persisted;
}

export function finalizePendingEvmRecord(
  storage: PendingEvmStorage | null,
  reservation: PendingEvmRecord,
  proof: Exclude<PendingEvmProof, { kind: "reservation" }>,
) {
  if (
    reservation.proof.kind !== "reservation"
    || (reservation.method === "direct" && proof.kind !== "hash")
    || (reservation.method === "batch" && proof.kind !== "calls")
  ) {
    return null;
  }
  const key = getPendingEvmRecordStorageKey(reservation);
  const reservationRaw = readStoredValue(storage, key);
  const expectedReservationRaw = JSON.stringify(reservation);
  if (reservationRaw !== expectedReservationRaw) return null;

  const proofCapturedAt = Date.now();
  const refreshedReservation: PendingEvmRecord = {
    ...reservation,
    submittedAt: proofCapturedAt,
  };
  const refreshedReservationRaw = JSON.stringify(refreshedReservation);
  const record: PendingEvmRecord = {
    ...reservation,
    proof,
    submittedAt: proofCapturedAt,
  };
  delete record.reservationPadding;
  const serializedRecord = JSON.stringify(record);
  if (!storage || serializedRecord.length > PENDING_EVM_MAX_RECORD_SIZE) {
    return { blocker: refreshedReservation, persisted: false as const, record };
  }
  try {
    // Refresh the ambiguity window before replacing proof. If the subsequent
    // smaller proof write unexpectedly fails, the durable reservation still
    // cannot become acknowledgeable until a full hard-lock window after the
    // wallet returned its hash/id.
    storage.setItem(key, refreshedReservationRaw);
    if (storage.getItem(key) !== refreshedReservationRaw) {
      return { blocker: refreshedReservation, persisted: false as const, record };
    }
    pendingMemoryRecords.set(key, refreshedReservationRaw);
    // Overwriting the padded reservation consumes no additional quota. If the
    // atomic set fails, the durable reservation remains and still blocks a
    // blind resend even though this live controller can monitor the proof.
    storage.setItem(key, serializedRecord);
    if (storage.getItem(key) !== serializedRecord) {
      return { blocker: refreshedReservation, persisted: false as const, record };
    }
  } catch {
    return { blocker: refreshedReservation, persisted: false as const, record };
  }
  pendingMemoryRecords.set(key, serializedRecord);
  pendingMemoryOnlyKeys.delete(key);
  dispatchPendingEvmChange({ attemptId: record.attemptId, key, operation: "write" });
  return { blocker: record, persisted: true as const, record };
}

function proofsMatch(left: PendingEvmProof, right: PendingEvmProof) {
  return left.kind === right.kind
    && (left.kind === "hash"
      ? left.hash === (right as Extract<PendingEvmProof, { kind: "hash" }>).hash
      : left.kind === "calls"
        ? left.id === (right as Extract<PendingEvmProof, { kind: "calls" }>).id
        : true);
}

function compareAndDeletePendingEvmRecord(
  storage: PendingEvmStorage | null,
  record: PendingEvmRecord,
  operation: "acknowledge" | "remove",
) {
  for (const key of [
    getPendingEvmRecordStorageKey(record),
    // Pre-attempt-key v2 migration path. Delete only the exact validated
    // legacy attempt; all new writes use immutable physical attempt keys.
    getPendingEvmStorageKey(record),
  ]) {
    const rawRecord = readStoredValue(storage, key);
    if (!rawRecord) continue;
    const currentRecord = parseStoredRecord(storage, key, record);
    if (
      !currentRecord
      || currentRecord.attemptId !== record.attemptId
      || !proofsMatch(currentRecord.proof, record.proof)
    ) {
      continue;
    }
    // A second authoritative read catches re-entrant/test-hook replacement.
    // Attempt-specific keys remove the remaining cross-tab ABA risk because a
    // newer attempt is stored under a different physical key.
    if (readStoredValue(storage, key) !== rawRecord) continue;
    return deleteRecordKey(storage, key, operation, record.attemptId, rawRecord);
  }
  return false;
}

export function removePendingEvmRecord(storage: PendingEvmStorage | null, record: PendingEvmRecord) {
  return compareAndDeletePendingEvmRecord(storage, record, "remove");
}

export function acknowledgePendingEvmRecord(
  storage: PendingEvmStorage | null,
  record: PendingEvmRecord,
  now = Date.now(),
) {
  if (getPendingEvmPhase(record, now) !== "stale") return false;
  // A live submission lease means a wallet interaction is still running for this
  // account — in this tab or another one. The player cannot have finished
  // checking a prompt that is still open, so the shortened ambiguous window must
  // never unlock underneath it.
  const leaseExpiresAt = getPendingEvmSubmissionLeaseExpiresAt(
    storage,
    { accountAddress: record.accountAddress, chainId: record.chainId },
    now,
  );
  if (leaseExpiresAt !== null && leaseExpiresAt > now) return false;
  return compareAndDeletePendingEvmRecord(storage, record, "acknowledge");
}

export function subscribePendingEvmChanges(listener: (change: PendingEvmChange) => void) {
  if (typeof window === "undefined") return () => {};
  const handleLocalChange = (event: Event) => {
    const detail = (event as CustomEvent<PendingEvmChange>).detail;
    if (detail?.key?.startsWith(`${PENDING_EVM_STORAGE_PREFIX}:`)) listener(detail);
  };
  const handleStorageChange = (event: StorageEvent) => {
    if (!event.key?.startsWith(`${PENDING_EVM_STORAGE_PREFIX}:`)) return;
    if (event.key.startsWith(`${PENDING_EVM_RECORD_PREFIX}:`)) {
      if (event.newValue === null) {
        pendingMemoryRecords.delete(event.key);
        pendingMemoryOnlyKeys.delete(event.key);
      } else {
        pendingMemoryRecords.set(event.key, event.newValue);
        pendingMemoryOnlyKeys.delete(event.key);
      }
    }
    const isLease = event.key.startsWith(`${PENDING_EVM_LEASE_PREFIX}:`)
      || event.key.startsWith(`${PENDING_EVM_STORAGE_PREFIX}:monitor:`);
    listener({
      key: event.key,
      operation: isLease
        ? event.newValue === null ? "release" : "claim"
        : event.newValue === null ? "remove" : "write",
    });
  };
  window.addEventListener(PENDING_EVM_CHANGE_EVENT, handleLocalChange);
  window.addEventListener("storage", handleStorageChange);
  return () => {
    window.removeEventListener(PENDING_EVM_CHANGE_EVENT, handleLocalChange);
    window.removeEventListener("storage", handleStorageChange);
  };
}

export type PendingEvmLeaseResult<T> =
  | { acquired: false; retryAt: number | null }
  | { acquired: true; value: T };

const leaseExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function schedulePendingEvmLeaseExpiry(
  storage: PendingEvmStorage | null,
  key: string,
  retryAt: number | null,
) {
  if (!retryAt || typeof window === "undefined") return;
  const existingTimer = leaseExpiryTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(() => {
    leaseExpiryTimers.delete(key);
    const nextExpiry = getStoredLeaseExpiresAt(storage, key);
    if (nextExpiry && nextExpiry > Date.now()) {
      schedulePendingEvmLeaseExpiry(storage, key, nextExpiry);
      return;
    }
    dispatchPendingEvmChange({ key, operation: "release" });
  }, Math.max(50, retryAt - Date.now() + 50));
  leaseExpiryTimers.set(key, timer);
}

const waitForLeaseContenders = () => new Promise<void>((resolve) => {
  setTimeout(resolve, 60);
});

async function runWithFallbackLease<T>({
  activeLeases,
  callback,
  heartbeatMs,
  key,
  leaseMs,
  storage,
}: {
  activeLeases: Map<string, number>;
  callback: (isLeaseCurrent: () => boolean) => Promise<T>;
  heartbeatMs: number;
  key: string;
  leaseMs: number;
  storage: PendingEvmStorage | null;
}): Promise<PendingEvmLeaseResult<T>> {
  const now = Date.now();
  const activeExpiry = activeLeases.get(key) ?? 0;
  if (activeExpiry > now) {
    schedulePendingEvmLeaseExpiry(storage, key, activeExpiry);
    return { acquired: false, retryAt: activeExpiry };
  }

  const token = createAttemptId();
  let expiresAt = now + leaseMs;
  let leaseValue = JSON.stringify({ expiresAt, token });
  const claimKey = getLeaseClaimKey(key, token);
  let heartbeatRef: ReturnType<typeof setInterval> | null = null;
  let acquired = false;
  let wroteClaim = false;
  activeLeases.set(key, expiresAt);
  try {
    if (!storage) {
      return { acquired: false, retryAt: null };
    }
    try {
      const beforeWrite = collectStoredLeases(storage, key);
      if (!beforeWrite.authoritative) return { acquired: false, retryAt: null };
      const incumbentExpiry = beforeWrite.leases.reduce<number | null>(
        (latest, lease) => latest === null ? lease.expiresAt : Math.max(latest, lease.expiresAt),
        null,
      );
      if (incumbentExpiry) {
        schedulePendingEvmLeaseExpiry(storage, key, incumbentExpiry);
        return { acquired: false, retryAt: incumbentExpiry };
      }

      storage.setItem(claimKey, leaseValue);
      wroteClaim = storage.getItem(claimKey) === leaseValue;
      if (!wroteClaim) return { acquired: false, retryAt: null };

      // Claims are immutable/token-specific. A contender can never overwrite
      // or delete another claimant. If claims overlap, every contender that
      // observes another live claim fails safely; a late claimant necessarily
      // observes an earlier winner's still-present claim.
      await waitForLeaseContenders();
      const afterWrite = collectStoredLeases(storage, key);
      if (!afterWrite.authoritative) return { acquired: false, retryAt: null };
      const otherClaims = afterWrite.leases.filter((lease) => lease.key !== claimKey);
      const ownClaim = afterWrite.leases.find((lease) => lease.key === claimKey);
      const ownClaimIsLive = ownClaim !== undefined
        && ownClaim.expiresAt > Date.now()
        && (activeLeases.get(key) ?? 0) > Date.now()
        && storage.getItem(claimKey) === leaseValue
        && parsePendingEvmLease(leaseValue) !== null;
      if (!ownClaimIsLive) {
        const retryAt = otherClaims.reduce(
          (latest, lease) => Math.max(latest, lease.expiresAt),
          0,
        ) || null;
        schedulePendingEvmLeaseExpiry(storage, key, retryAt);
        return { acquired: false, retryAt };
      }
      if (otherClaims.length > 0) {
        const retryAt = otherClaims.reduce(
          (latest, lease) => Math.max(latest, lease.expiresAt),
          0,
        ) || null;
        schedulePendingEvmLeaseExpiry(storage, key, retryAt);
        return { acquired: false, retryAt };
      }
    } catch {
      return { acquired: false, retryAt: null };
    }

    acquired = true;
    dispatchPendingEvmChange({ key, operation: "claim" });
    heartbeatRef = setInterval(() => {
      expiresAt = Date.now() + leaseMs;
      activeLeases.set(key, expiresAt);
      try {
        // Never resurrect an expired token after suspension, nor overwrite a
        // token another tab has replaced.
        if (
          storage.getItem(claimKey) !== leaseValue
          || parsePendingEvmLease(leaseValue) === null
        ) {
          activeLeases.delete(key);
          return;
        }
        const nextLeaseValue = JSON.stringify({ expiresAt, token });
        storage.setItem(claimKey, nextLeaseValue);
        if (storage.getItem(claimKey) === nextLeaseValue) leaseValue = nextLeaseValue;
      } catch {
        // The active same-document owner remains fenced by the map.
      }
    }, heartbeatMs);
    const isLeaseCurrent = () => {
      if ((activeLeases.get(key) ?? 0) <= Date.now()) return false;
      try {
        return storage.getItem(claimKey) === leaseValue
          && parsePendingEvmLease(leaseValue) !== null;
      } catch {
        return false;
      }
    };
    return { acquired: true, value: await callback(isLeaseCurrent) };
  } finally {
    if (heartbeatRef !== null) clearInterval(heartbeatRef);
    activeLeases.delete(key);
    if (wroteClaim) {
      try {
        if (storage?.getItem(claimKey) === leaseValue) storage.removeItem(claimKey);
      } catch {
        // The immutable claim expires without affecting a successor.
      }
    }
    if (acquired || wroteClaim) {
      const expiryTimer = leaseExpiryTimers.get(key);
      if (expiryTimer) {
        clearTimeout(expiryTimer);
        leaseExpiryTimers.delete(key);
      }
      schedulePendingEvmLeaseExpiry(storage, key, getStoredLeaseExpiresAt(storage, key));
      dispatchPendingEvmChange({ key, operation: "release" });
    }
  }
}

export async function withPendingEvmSubmissionLease<T>(
  storage: PendingEvmStorage | null,
  registry: PendingEvmRegistryIdentity,
  callback: () => Promise<T>,
): Promise<PendingEvmLeaseResult<T>> {
  const lockName = getSubmissionLeaseKey(registry);
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(
      lockName,
      { ifAvailable: true },
      async (lock) => lock
        ? runWithFallbackLease({
          activeLeases: activeSubmissionLeases,
          callback,
          heartbeatMs: PENDING_EVM_SUBMISSION_HEARTBEAT_MS,
          key: lockName,
          leaseMs: PENDING_EVM_SUBMISSION_LEASE_MS,
          storage,
        })
        : {
          acquired: false,
          retryAt: getPendingEvmSubmissionLeaseExpiresAt(storage, registry),
        } as const,
    );
  }
  return runWithFallbackLease({
    activeLeases: activeSubmissionLeases,
    callback,
    heartbeatMs: PENDING_EVM_SUBMISSION_HEARTBEAT_MS,
    key: lockName,
    leaseMs: PENDING_EVM_SUBMISSION_LEASE_MS,
    storage,
  });
}

export async function withPendingEvmSubmissionGuard<T>(
  storage: PendingEvmStorage | null,
  registry: PendingEvmRegistryIdentity,
  callback: () => Promise<T>,
) {
  if (!canDurablyPersistPendingEvmTransactions(storage)) {
    throw new PendingEvmStorageUnavailableError();
  }
  return withPendingEvmSubmissionLease(storage, registry, async () => {
    const registryScan = scanPendingEvmRecords(storage, registry);
    if (!registryScan.authoritative) throw new PendingEvmStorageUnavailableError();
    const blocker = registryScan.records[0] ?? null;
    if (blocker) return { blocker, submitted: false as const };
    return { submitted: true as const, value: await callback() };
  });
}

export async function withPendingEvmMonitorLease<T>(
  storage: PendingEvmStorage | null,
  record: PendingEvmRecord,
  callback: (isLeaseCurrent: () => boolean) => Promise<T>,
): Promise<PendingEvmLeaseResult<T>> {
  const key = getMonitorLeaseKey(record);
  const run = () => runWithFallbackLease({
    activeLeases: activeMonitorLeases,
    callback,
    heartbeatMs: PENDING_EVM_MONITOR_HEARTBEAT_MS,
    key,
    leaseMs: PENDING_EVM_MONITOR_LEASE_MS,
    storage,
  });

  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(
      key,
      { ifAvailable: true },
      async (lock) => lock
        ? run()
        : {
          acquired: false,
          retryAt: getPendingEvmMonitorLeaseExpiresAt(storage, record),
        } as const,
    );
  }
  return run();
}

export function resumePendingEvmRecord<TReceipt, TCallsStatus>(
  record: PendingEvmRecord,
  waiters: {
    waitForCallsStatus: (id: string) => Promise<TCallsStatus>;
    waitForReceipt: (hash: Hex) => Promise<TReceipt>;
  },
) {
  if (record.proof.kind === "reservation") {
    return Promise.reject(new Error("This wallet submission has not returned transaction proof yet."));
  }
  return record.proof.kind === "hash"
    ? waiters.waitForReceipt(record.proof.hash)
    : waiters.waitForCallsStatus(record.proof.id);
}

export function withPendingEvmHardDeadline<T>(promise: Promise<T>, record: PendingEvmRecord) {
  const remainingMs = record.submittedAt + PENDING_EVM_HARD_LOCK_MS - Date.now();
  if (remainingMs <= 0) return Promise.reject(new PendingEvmStaleError());
  let timeoutRef: ReturnType<typeof setTimeout> | null = null;
  const stalePromise = new Promise<never>((_, reject) => {
    timeoutRef = setTimeout(() => reject(new PendingEvmStaleError()), remainingMs);
  });
  return Promise.race([promise, stalePromise]).finally(() => {
    if (timeoutRef !== null) clearTimeout(timeoutRef);
  }) as Promise<T>;
}
