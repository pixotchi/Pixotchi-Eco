import { createHash, randomUUID } from 'node:crypto';
import { decodeEventLog, encodeFunctionData, erc20Abi, parseAbiItem, parseUnits, type Hex, type TransactionReceipt } from 'viem';
import { entryPoint06Address, entryPoint07Address, entryPoint08Address, entryPoint09Address } from 'viem/account-abstraction';
import { getAirdropRecordStatus, type AirdropEligibilityRecord } from './airdrop-claim-state';
import { isAirdropTransactionHash, isAirdropUserOperationHash } from './airdrop-claim-reconciliation';

export const AIRDROP_TOKENS = {
  seed: '0x546D239032b24eCEEE0cb05c92FC39090846adc7',
  leaf: '0xE78ee52349D7b031E2A6633E07c037C3147DB116',
  pixotchi: '0xa2ef17bb7eea1143196678337069dfa24d37d2ac',
} as const;
export type AirdropCall = { to: Hex; value: string; data: Hex };
export type AirdropPhase = 'reserved' | 'prepared' | 'signed' | 'broadcasting' | 'pending' | 'claimed' | 'failed' | 'manual_review';
export type AirdropProof = { transactionHash: Hex; blockHash: Hex; blockNumber: string; userOpHash: Hex; sender: string; entryPoint: string; success: boolean; logIndex: number };
export type AirdropExecution = {
  version: 2;
  recipient: string;
  agentAddress: string;
  network: 'base';
  calls: AirdropCall[];
  callsDigest: string;
  allocation: { seed: string; leaf: string; pixotchi: string };
  phase: AirdropPhase;
  createdAt: number;
  updatedAt: number;
  leaseOwner: string;
  leaseExpiresAt: number;
  broadcastKey: string;
  preparedUserOpHash?: Hex;
  preparedAt?: number;
  expiresAt?: string;
  /** Server-only: never include the execution record in public responses. */
  signature?: Hex;
  firstBroadcastStartedAt?: number;
  proof?: AirdropProof;
};
export type AirdropOperation = {
  userOpHash: Hex; network: string; calls: AirdropCall[]; status: string;
  transactionHash?: Hex; expiresAt?: string;
};
export interface AirdropAdapter {
  address(): Promise<string>;
  prepare(calls: AirdropCall[]): Promise<AirdropOperation>;
  sign(hash: Hex): Promise<Hex>;
  broadcast(hash: Hex, signature: Hex, key: string): Promise<AirdropOperation>;
  observe(address: string, hash: Hex): Promise<AirdropOperation>;
  receipt(hash: Hex): Promise<TransactionReceipt>;
}
export type AirdropSnapshot = { raw: string; record: AirdropEligibilityRecord };
export interface AirdropStore {
  read(): Promise<AirdropSnapshot | null>;
  cas(expectedRaw: string, next: AirdropEligibilityRecord): Promise<boolean>;
  metric?(event: AirdropMetric): Promise<void>;
}
export type AirdropMetric = 'new_attempt' | 'broadcast_uncertain' | 'legacy_ambiguous_observed' | 'manual_review' | 'claimed' | 'failed' | 'stale_cas';
const LEASE_MS = 60_000;
const EXPIRY_MARGIN_MS = 5_000;

export function buildAirdropCalls(record: AirdropEligibilityRecord, recipient: Hex): AirdropCall[] {
  return Object.entries(AIRDROP_TOKENS).flatMap(([field, token]) => {
    const amount = record[field as keyof typeof AIRDROP_TOKENS] ?? '0';
    if (typeof amount !== 'string' || !/^\d+(?:\.\d{1,18})?$/.test(amount)) throw new Error('Invalid airdrop allocation');
    const value = parseUnits(amount, 18);
    return value === BigInt(0) ? [] : [{ to: token as Hex, value: '0', data: encodeFunctionData({
      abi: erc20Abi, functionName: 'transfer', args: [recipient, value],
    }) }];
  });
}
export function airdropCallsDigest(calls: AirdropCall[]): string {
  return createHash('sha256').update(JSON.stringify(calls.map(c => ({ to: c.to.toLowerCase(), value: BigInt(c.value).toString(), data: c.data.toLowerCase() })))).digest('hex');
}
export function matchesAirdropOperation(operation: AirdropOperation, hash: Hex, calls: AirdropCall[]): boolean {
  try {
    return operation.userOpHash?.toLowerCase() === hash.toLowerCase() && operation.network === 'base'
      && airdropCallsDigest(operation.calls) === airdropCallsDigest(calls);
  } catch { return false; }
}

const USER_OPERATION_EVENT = parseAbiItem('event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)');
const BEFORE_EXECUTION_EVENT = parseAbiItem('event BeforeExecution()');
const ENTRY_POINTS = new Set([entryPoint06Address, entryPoint07Address, entryPoint08Address, entryPoint09Address].map(address => address.toLowerCase()));

/** Match the exact ERC-4337 operation and its execution-log segment, not the entire bundle. */
export function getAirdropReceiptProof(receipt: TransactionReceipt, hash: Hex, txHash: Hex, calls: AirdropCall[], agent: string, recipient: string): AirdropProof | null {
  if (receipt.status !== 'success' || receipt.transactionHash.toLowerCase() !== txHash.toLowerCase() || !receipt.blockHash) return null;
  let start = 0;
  for (let i = 0; i < receipt.logs.length; i++) {
    const log = receipt.logs[i];
    if (!ENTRY_POINTS.has(log.address.toLowerCase())) continue;
    try {
      const decoded = decodeEventLog({ abi: [USER_OPERATION_EVENT, BEFORE_EXECUTION_EVENT], topics: log.topics, data: log.data });
      if (decoded.eventName === 'BeforeExecution') { start = i + 1; continue; }
      if (decoded.args.userOpHash.toLowerCase() !== hash.toLowerCase()) { start = i + 1; continue; }
      if (decoded.args.sender.toLowerCase() !== agent.toLowerCase()) return null;
      const proof: AirdropProof = { transactionHash: txHash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber.toString(), userOpHash: hash, sender: agent, entryPoint: log.address, success: decoded.args.success, logIndex: log.logIndex };
      if (!decoded.args.success) return proof;
      const paid = calls.every(call => {
        const amount = BigInt(`0x${call.data.slice(-64)}`);
        let transferred = BigInt(0);
        for (const transferLog of receipt.logs.slice(start, i)) {
          if (transferLog.address.toLowerCase() !== call.to.toLowerCase()) continue;
          try {
            const decoded = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', topics: transferLog.topics, data: transferLog.data });
            if (decoded.args.from.toLowerCase() === agent.toLowerCase() && decoded.args.to.toLowerCase() === recipient.toLowerCase()) transferred += decoded.args.value;
          } catch { /* Other token events are unrelated. */ }
        }
        return transferred === amount;
      });
      return paid ? proof : null;
    } catch { /* Other EntryPoint events. */ }
  }
  return null;
}

export function getAirdropRecovery(record: AirdropEligibilityRecord, now = Date.now()) {
  const status = getAirdropRecordStatus(record);
  const execution = record.execution;
  if (status === 'claimed') return { recoveryState: 'complete', retryAllowed: false } as const;
  if (record.recoveryState === 'manual_review' || execution?.phase === 'manual_review') return { recoveryState: 'manual_review', retryAllowed: false } as const;
  if (status === 'failed' && record.confirmedProof?.success !== false) return { recoveryState: 'manual_review', retryAllowed: false } as const;
  if (status === 'eligible' || status === 'failed') return { recoveryState: 'ready', retryAllowed: true } as const;
  if (!execution && !isAirdropUserOperationHash(record.operationId)) {
    return { recoveryState: 'manual_review', retryAllowed: false } as const;
  }
  if (execution && execution.leaseExpiresAt <= now && ['reserved', 'prepared', 'signed', 'broadcasting'].includes(execution.phase)) {
    return { recoveryState: 'retryable', retryAllowed: true } as const;
  }
  return { recoveryState: 'processing', retryAllowed: false } as const;
}
export function publicAirdropStatus(record: AirdropEligibilityRecord, now = Date.now()) {
  const status = getAirdropRecordStatus(record);
  return {
    eligible: true, seed: record.seed ?? '0', leaf: record.leaf ?? '0', pixotchi: record.pixotchi ?? '0',
    claimed: status === 'claimed', status, attemptId: record.attemptId ?? null, operationId: record.operationId ?? null,
    claimedAt: record.claimedAt ?? null, txHash: status === 'claimed' ? record.txHash ?? null : null,
    ...getAirdropRecovery(record, now),
  };
}

export function isAirdropObservable(record: AirdropEligibilityRecord): boolean {
  return getAirdropRecordStatus(record) === 'pending' && isAirdropUserOperationHash(record.operationId)
    && getAirdropRecovery(record).recoveryState !== 'manual_review'
    && (!record.execution || record.execution.firstBroadcastStartedAt !== undefined);
}

export async function observeAirdrop(snapshot: AirdropSnapshot, store: AirdropStore, adapter: AirdropAdapter, now = Date.now(), legacyRecipient?: Hex): Promise<AirdropSnapshot> {
  const record = snapshot.record;
  if (getAirdropRecordStatus(record) !== 'pending') return snapshot;
  if (!isAirdropUserOperationHash(record.operationId) || getAirdropRecovery(record, now).recoveryState === 'manual_review') {
    if (!record.execution && !record.operationId) await store.metric?.('legacy_ambiguous_observed').catch(() => {});
    return snapshot;
  }
  // GET only observes previously attempted broadcasts. A saved, unsigned preparation is not a payout.
  if (record.execution && record.execution.firstBroadcastStartedAt === undefined) return snapshot;
  try {
    const agent = record.execution?.agentAddress ?? record.reconciliation?.agentAddress ?? await adapter.address();
    const recipient = record.execution?.recipient ?? legacyRecipient;
    // Legacy records are scoped to the recipient by the caller before observation.
    const calls = record.execution?.calls ?? (legacyRecipient ? buildAirdropCalls(record, legacyRecipient) : undefined);
    if (!recipient || !calls) return snapshot;
    const operation = await adapter.observe(agent, record.operationId);
    let update: Partial<AirdropEligibilityRecord> | null = null;
    let phase: AirdropPhase | undefined;
    let proof: AirdropProof | null = null;
    if (!matchesAirdropOperation(operation, record.operationId, calls)) phase = 'manual_review';
    else if (['complete', 'failed'].includes(operation.status) && isAirdropTransactionHash(operation.transactionHash)) {
      let receipt: TransactionReceipt | undefined;
      try { receipt = await adapter.receipt(operation.transactionHash); } catch { /* Not safe yet, or temporarily unavailable. */ }
      if (!receipt) phase = 'pending';
      else proof = getAirdropReceiptProof(receipt, record.operationId, operation.transactionHash, calls, agent, recipient);
      if (receipt && proof?.success) {
        update = { claimed: true, status: 'claimed', claimedAt: now, txHash: operation.transactionHash };
        phase = 'claimed';
      } else if (receipt && proof && !proof.success) {
        update = { claimed: false, status: 'failed', failedAt: now, failureReason: 'Operation reverted onchain' };
        phase = 'failed';
      } else if (receipt) phase = 'manual_review';
    } else if (['failed', 'dropped'].includes(operation.status)) {
      // Dropped is not a canonical failed receipt; require review before replacing it.
      phase = 'manual_review';
    } else if (operation.status === 'broadcast') phase = 'pending';
    else if (['pending', 'signed'].includes(operation.status) && record.execution?.expiresAt
      && Date.parse(record.execution.expiresAt) <= now) phase = 'manual_review';
    if (!phase || (phase === record.execution?.phase && !update)) return snapshot;
    const next = { ...record, ...update, ...(phase === 'manual_review' ? { recoveryState: 'manual_review' as const } : {}), ...(proof ? { confirmedProof: proof } : {}), execution: record.execution ? { ...record.execution, ...(proof ? { proof } : {}), phase, updatedAt: now } : undefined };
    if (await store.cas(snapshot.raw, next)) {
      if (['claimed', 'failed', 'manual_review'].includes(phase)) await store.metric?.(phase as AirdropMetric).catch(() => {});
      return { raw: JSON.stringify(next), record: next };
    }
    return await store.read() ?? snapshot;
  } catch { return snapshot; } // CDP/RPC unavailability does not prove nonpayment.
}

/** Persisted ownership/phase/hash fence every external action. No lease can reset a possibly broadcast operation. */
export async function runAirdropClaim(store: AirdropStore, adapter: AirdropAdapter, recipient: Hex, options: { now?: () => number; uuid?: () => string } = {}): Promise<AirdropEligibilityRecord> {
  const now = options.now ?? Date.now;
  const uuid = options.uuid ?? randomUUID;
  let snapshot = await store.read();
  if (!snapshot) throw new Error('Not eligible for airdrop');
  if (getAirdropRecordStatus(snapshot.record) === 'claimed') return snapshot.record;
  if (snapshot.record.status === 'pending') snapshot = await observeAirdrop(snapshot, store, adapter, now(), recipient);
  let record = snapshot.record;
  if (!getAirdropRecovery(record, now()).retryAllowed) return record;
  const owner = uuid();
  const persist = async (next: AirdropEligibilityRecord) => {
    if (!await store.cas(snapshot!.raw, next)) { await store.metric?.('stale_cas').catch(() => {}); throw new Error('Airdrop state changed'); }
    const transitionedToReview = next.execution?.phase === 'manual_review' && record.execution?.phase !== 'manual_review';
    snapshot = { raw: JSON.stringify(next), record: next };
    record = next;
    if (transitionedToReview) await store.metric?.('manual_review').catch(() => {});
  };
  try {
    if (!record.execution || record.status === 'failed') {
      const calls = buildAirdropCalls(record, recipient);
      const agentAddress = await adapter.address();
      await persist({ ...record, claimed: false, status: 'pending', attemptId: uuid(), operationId: undefined,
        reservedAt: now(), txHash: undefined, failureReason: undefined, execution: {
          version: 2, network: 'base', recipient: recipient.toLowerCase(), agentAddress,
          allocation: { seed: record.seed ?? '0', leaf: record.leaf ?? '0', pixotchi: record.pixotchi ?? '0' },
          calls, callsDigest: airdropCallsDigest(calls), phase: 'reserved', createdAt: now(), updatedAt: now(),
          leaseOwner: owner, leaseExpiresAt: now() + LEASE_MS, broadcastKey: uuid(),
        } });
      await store.metric?.('new_attempt').catch(() => {});
    } else {
      await persist({ ...record, execution: { ...record.execution, leaseOwner: owner, leaseExpiresAt: now() + LEASE_MS } });
    }
    const update = async (changes: Partial<AirdropExecution>, fields: Partial<AirdropEligibilityRecord> = {}) => {
      await persist({ ...record, ...fields, execution: { ...record.execution!, ...changes, updatedAt: now() } });
    };
    let execution = record.execution!;
    if (execution.recipient !== recipient.toLowerCase() || execution.callsDigest !== airdropCallsDigest(buildAirdropCalls(record, recipient))
      || execution.callsDigest !== airdropCallsDigest(execution.calls) || (await adapter.address()).toLowerCase() !== execution.agentAddress.toLowerCase()) {
      await update({ phase: 'manual_review', leaseExpiresAt: now() });
      return record;
    }
    if (execution.calls.length === 0) {
      await update({ phase: 'claimed', leaseExpiresAt: now() }, { status: 'claimed', claimed: true, claimedAt: now(), txHash: null });
      return record;
    }
    if (execution.phase === 'broadcasting') {
      // The only permissible resend is the already persisted hash and signature.
      if (!execution.preparedUserOpHash || !execution.signature || !execution.expiresAt || Date.parse(execution.expiresAt) <= now() + EXPIRY_MARGIN_MS) {
        await update({ phase: 'manual_review', leaseExpiresAt: now() });
        return record;
      }
    } else {
      if (execution.firstBroadcastStartedAt !== undefined) {
        await update({ phase: 'manual_review', leaseExpiresAt: now() });
        return record;
      }
      if (execution.expiresAt && Date.parse(execution.expiresAt) <= now() + EXPIRY_MARGIN_MS) {
        // The old worker cannot pass its signed→broadcasting CAS after this transition.
        await update({ phase: 'reserved', preparedUserOpHash: undefined, preparedAt: undefined, signature: undefined, expiresAt: undefined, broadcastKey: uuid() }, { operationId: undefined });
      }
      execution = record.execution!;
      if (execution.phase === 'reserved') {
        const prepared = await adapter.prepare(execution.calls);
        if (!isAirdropUserOperationHash(prepared.userOpHash) || !matchesAirdropOperation(prepared, prepared.userOpHash, execution.calls)
          || !prepared.expiresAt || !Number.isFinite(Date.parse(prepared.expiresAt)) || Date.parse(prepared.expiresAt) <= now() + EXPIRY_MARGIN_MS) {
          await update({ phase: 'manual_review', leaseExpiresAt: now() });
          return record;
        }
        await update({ phase: 'prepared', preparedUserOpHash: prepared.userOpHash, preparedAt: now(), expiresAt: prepared.expiresAt }, { operationId: prepared.userOpHash });
      }
      execution = record.execution!;
      if (execution.phase === 'prepared') {
        // Reaffirm the exact owner/phase/hash before requesting a signature.
        await update({ leaseExpiresAt: now() + LEASE_MS });
        const signature = await adapter.sign(execution.preparedUserOpHash!);
        if (!/^0x[0-9a-f]{130}$/i.test(signature)) throw new Error('Invalid operation signature');
        await update({ phase: 'signed', signature });
      }
      execution = record.execution!;
      if (Date.parse(execution.expiresAt!) <= now() + EXPIRY_MARGIN_MS) {
        await update({ leaseExpiresAt: now() });
        return record; // Prepared-only retry can safely replace it next time.
      }
      await update({ phase: 'broadcasting', firstBroadcastStartedAt: now() });
    }
    // Every network send, including a recovery resend, gets an exact-record CAS fence.
    await update({ leaseExpiresAt: now() + LEASE_MS });
    execution = record.execution!;
    const sent = await adapter.broadcast(execution.preparedUserOpHash!, execution.signature!, execution.broadcastKey);
    if (!matchesAirdropOperation(sent, execution.preparedUserOpHash!, execution.calls)) {
      await update({ phase: 'manual_review', leaseExpiresAt: now() });
      return record;
    }
    await update({ leaseExpiresAt: now() });
    snapshot = await observeAirdrop(snapshot!, store, adapter, now());
    return snapshot.record;
  } catch {
    // Never serialize SDK errors: request configs may contain wallet auth or signatures.
    // Releasing our own lease is CAS-protected; a newer worker/status response wins.
    if (record.execution?.leaseOwner === owner) {
      if (record.execution.firstBroadcastStartedAt !== undefined) await store.metric?.('broadcast_uncertain').catch(() => {});
      const next = { ...record, execution: { ...record.execution, leaseExpiresAt: now(), updatedAt: now() } };
      await store.cas(snapshot!.raw, next).catch(() => false);
    }
    return (await store.read())?.record ?? record;
  }
}
