import assert from 'node:assert/strict';
import { ContractFunctionRevertedError, encodeErrorResult, keccak256, stringToHex, type Hex } from 'viem';
import { createBaseRpcFailure, toBaseRpcWireError } from '../lib/base-rpc-errors';
import {
  PENDING_EVM_AMBIGUOUS_ACK_LOCK_MS,
  PENDING_EVM_HARD_LOCK_MS,
  PENDING_EVM_MAX_RECORD_SIZE,
  PENDING_EVM_PROXY_NOT_FORWARDED_MARKER,
  acknowledgePendingEvmRecord,
  createPendingEvmCallsDigest,
  createPendingEvmRecord,
  finalizePendingEvmRecord,
  getPendingEvmPhase,
  getPendingEvmStorageKey,
  isDefinitivePendingEvmPreSubmissionError,
  readPendingEvmRecord,
  removePendingEvmRecord,
  replacePendingEvmProof,
  retryPendingEvmProofPersistence,
  withPendingEvmMonitorLease,
  withPendingEvmSubmissionLease,
  withPendingEvmSubmissionGuard,
  writePendingEvmRecord,
  type PendingEvmRecord,
  type PendingEvmStorage,
} from '../lib/pending-evm-transaction';

class MemoryStorage implements PendingEvmStorage {
  values = new Map<string, string>();
  failWrites = false;
  failProofWrites = false;
  failReads = false;
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) {
    if (this.failReads) throw new Error('read unavailable');
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites || (this.failProofWrites && key.includes(':record:') && value.length < 3_500)) {
      throw new Error('write unavailable');
    }
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}

const hashA = `0x${'aa'.repeat(32)}` as Hex;
const hashB = `0x${'bb'.repeat(32)}` as Hex;
const hashC = `0x${'cc'.repeat(32)}` as Hex;
const callsDigest = createPendingEvmCallsDigest([]);
let fixtureIndex = 0;
function fixture(age = PENDING_EVM_AMBIGUOUS_ACK_LOCK_MS + 1_000) {
  fixtureIndex += 1;
  const identity = {
    accountAddress: `0x${fixtureIndex.toString(16).padStart(40, '0')}`,
    chainId: 8453,
    intentKey: `pending-proof-smoke:${fixtureIndex}`,
  };
  const reservation = createPendingEvmRecord({
    identity, callsDigest, method: 'direct', proof: { kind: 'reservation' },
    submittedAt: Date.now() - age,
  });
  const storage = new MemoryStorage();
  assert.equal(writePendingEvmRecord(storage, reservation), true);
  const key = `${getPendingEvmStorageKey(reservation)}:attempt:${keccak256(stringToHex(reservation.attemptId))}`;
  return { identity, key, reservation, storage };
}

async function main() {
  // A contract controls Error(string) revert contents. Decode the actual ABI
  // bytes through Viem so its formatted message contains the proxy marker,
  // then wrap it in an ambiguous transport failure just like a wallet can.
  {
    const abi = [{ type: 'error', name: 'Error', inputs: [{ name: 'reason', type: 'string' }] }] as const;
    const reason = `Contract reason: ${PENDING_EVM_PROXY_NOT_FORWARDED_MARKER}`;
    const decodedRevert = new ContractFunctionRevertedError({
      abi,
      functionName: 'submitAction',
      data: encodeErrorResult({ abi, errorName: 'Error', args: [reason] }),
    });
    assert.equal(decodedRevert.reason, reason);
    assert.match(decodedRevert.message, /PIXOTCHI_PROXY_NOT_FORWARDED/);
    for (const outerMessage of ['Network connection failed', 'Wallet broadcast response was lost']) {
      const error = new Error(outerMessage, { cause: decodedRevert });
      const { identity, key, reservation, storage } = fixture(0);
      const mayRelease = isDefinitivePendingEvmPreSubmissionError(error);
      if (mayRelease) removePendingEvmRecord(storage, reservation);
      let walletSubmissions = 0;
      const guarded = await withPendingEvmSubmissionGuard(storage, identity, async () => {
        walletSubmissions += 1;
      });
      assert.equal(mayRelease, false, 'contract text cannot prove a request was never forwarded');
      assert.equal(walletSubmissions, 0, 'the retained reservation must prevent another wallet submission');
      assert.equal(guarded.acquired && guarded.value.submitted, false);
      assert.notEqual(storage.getItem(key), null);
      assert.equal(removePendingEvmRecord(storage, reservation), true);
    }

    const timeoutWire = toBaseRpcWireError(createBaseRpcFailure('timeout'));
    const formattedTimeout = Object.assign(new Error(
      `RPC request failed. Request body: ${JSON.stringify({ note: PENDING_EVM_PROXY_NOT_FORWARDED_MARKER })}`,
    ), { code: timeoutWire.code, data: timeoutWire.data });
    assert.equal(isDefinitivePendingEvmPreSubmissionError(formattedTimeout), false,
      'a structured failure without forwarded:false must ignore a marker in formatted request data');

    const refusedRateLimit = toBaseRpcWireError(createBaseRpcFailure('rate_limited', { forwarded: false }));
    assert.equal(isDefinitivePendingEvmPreSubmissionError(refusedRateLimit), true,
      'trusted forwarded:false provenance remains definitive despite rate-limit wording');
    assert.equal(isDefinitivePendingEvmPreSubmissionError(new Error(
      `${PENDING_EVM_PROXY_NOT_FORWARDED_MARKER}: Too many requests (429)`,
    )), true, 'plain genuine legacy proxy refusals retain compatibility');

    const cleanRevert = new ContractFunctionRevertedError({
      abi,
      functionName: 'submitAction',
      data: encodeErrorResult({ abi, errorName: 'Error', args: ['No harvest is available'] }),
    });
    assert.equal(isDefinitivePendingEvmPreSubmissionError(cleanRevert), true,
      'a clean typed revert still definitively rejects the attempted execution');
    const codeThreeRevert = Object.assign(new Error(reason), { code: 3 });
    assert.equal(isDefinitivePendingEvmPreSubmissionError(new Error(
      'Wallet broadcast response was lost', { cause: codeThreeRevert },
    )), false, 'a typed RPC revert cannot promote its reason text to proxy provenance');
  }

  // A stale UI reference cannot remove a refreshed durable record, even when
  // there is no in-memory queued proof to provide an additional safeguard.
  {
    const { key, reservation, storage } = fixture();
    const refreshed = { ...reservation, submittedAt: Date.now(), proofCaptured: true as const };
    storage.setItem(key, JSON.stringify(refreshed));
    assert.equal(getPendingEvmPhase(reservation), 'stale');
    assert.equal(getPendingEvmPhase(refreshed), 'hard');
    assert.equal(await acknowledgePendingEvmRecord(storage, reservation), false);
    assert.equal(storage.getItem(key), JSON.stringify(refreshed));
    assert.equal(removePendingEvmRecord(storage, refreshed), true);
  }

  // The captured-proof fallback keeps thirty minutes; ordinary reservations
  // still use five minutes, and owning the acknowledgement leases is allowed.
  {
    const { identity, key, reservation, storage } = fixture();
    storage.failProofWrites = true;
    const finalized = finalizePendingEvmRecord(storage, reservation, { kind: 'hash', hash: hashA })!;
    assert.equal(finalized.persisted, false);
    const durable = readPendingEvmRecord(storage, identity)!;
    assert.equal(durable.proofCaptured, true);
    assert.ok(storage.getItem(key)!.length <= PENDING_EVM_MAX_RECORD_SIZE);
    assert.equal(await acknowledgePendingEvmRecord(storage, reservation), false);
    const afterFiveMinutes = finalized.record.submittedAt + PENDING_EVM_AMBIGUOUS_ACK_LOCK_MS + 1;
    assert.equal(getPendingEvmPhase(durable, afterFiveMinutes), 'hard');
    assert.equal(await acknowledgePendingEvmRecord(storage, durable, afterFiveMinutes), false);
    assert.equal(await acknowledgePendingEvmRecord(
      storage, durable, finalized.record.submittedAt + PENDING_EVM_HARD_LOCK_MS + 1,
    ), true);
    storage.failProofWrites = false;
    assert.equal(await retryPendingEvmProofPersistence(storage), 0, 'acknowledged proof must not resurrect');
    assert.equal(storage.getItem(key), null);
  }
  {
    const { reservation, storage } = fixture();
    assert.equal(await acknowledgePendingEvmRecord(storage, reservation), true);
  }

  // Either existing owner blocks acknowledgement; the nested acquisitions
  // must return instead of waiting indefinitely on the caller's own lease.
  {
    const { reservation, storage } = fixture();
    await withPendingEvmSubmissionLease(storage, reservation, async (isCurrent) => {
      assert.equal(isCurrent(), true);
      assert.equal(await acknowledgePendingEvmRecord(storage, reservation), false);
    });
    await withPendingEvmMonitorLease(storage, reservation, async () => {
      assert.equal(await acknowledgePendingEvmRecord(storage, reservation), false);
    });
    storage.failReads = true;
    assert.equal(await acknowledgePendingEvmRecord(storage, reservation), false);
    storage.failReads = false;
    // A storage outage after the lease write can prevent owner cleanup. That
    // conservative claim remains a blocker until its two-minute expiry.
    const realNow = Date.now;
    const afterLeaseExpiry = realNow() + 3 * 60_000;
    Date.now = () => afterLeaseExpiry;
    try {
      assert.equal(await acknowledgePendingEvmRecord(storage, reservation), true);
    } finally {
      Date.now = realNow;
    }
  }

  // Even two stale timestamps are distinct revisions. A refreshed snapshot is
  // required instead of accepting only matching attemptId and proof kind.
  {
    const { key, reservation, storage } = fixture(2 * PENDING_EVM_HARD_LOCK_MS);
    const changed = { ...reservation, submittedAt: reservation.submittedAt + 1_000 };
    storage.setItem(key, JSON.stringify(changed));
    assert.equal(await acknowledgePendingEvmRecord(storage, reservation), false);
    assert.equal(await acknowledgePendingEvmRecord(storage, changed), true);
  }

  for (const failFirstWrite of [false, true]) {
    const { identity, key, reservation, storage } = fixture();
    storage.failWrites = failFirstWrite;
    storage.failProofWrites = !failFirstWrite;
    const finalized = finalizePendingEvmRecord(storage, reservation, { kind: 'hash', hash: hashA })!;
    assert.equal(finalized.persisted, false);
    assert.equal(await acknowledgePendingEvmRecord(storage, reservation), false);
    assert.equal(JSON.parse(storage.getItem(key)!).proof.kind, 'reservation');
    storage.failWrites = false;
    storage.failProofWrites = false;
    assert.equal(await retryPendingEvmProofPersistence(storage), 1);
    const recovered = readPendingEvmRecord(storage, identity)!;
    assert.deepEqual(recovered.proof, { kind: 'hash', hash: hashA });
    assert.equal(recovered.initialTransactionHash, hashA);
    assert.equal(recovered.proofCaptured, undefined);
    assert.equal(removePendingEvmRecord(storage, recovered), true);
  }

  // Persistence retry cannot replace a proof written by a newer observer.
  {
    const { key, reservation, storage } = fixture();
    storage.failProofWrites = true;
    const finalized = finalizePendingEvmRecord(storage, reservation, { kind: 'hash', hash: hashA })!;
    const newer = { ...finalized.record, proof: { kind: 'hash' as const, hash: hashB } };
    storage.values.set(key, JSON.stringify(newer));
    storage.failProofWrites = false;
    assert.equal(await retryPendingEvmProofPersistence(storage), 0);
    assert.equal(storage.getItem(key), JSON.stringify(newer));
    assert.equal(removePendingEvmRecord(storage, newer), true);
  }

  // A failed replacement write still returns the observed cancellation. A
  // concurrent stale repricing callback must merge the queued disposition.
  {
    const { identity, reservation, storage } = fixture();
    const original = finalizePendingEvmRecord(storage, reservation, { kind: 'hash', hash: hashA })!.record;
    storage.failWrites = true;
    const cancelled = replacePendingEvmProof(storage, original, { kind: 'hash', hash: hashB }, {
      disposition: 'cancelled', previousHash: hashA, transactionHash: hashB, verified: true,
    })!;
    assert.equal(cancelled.replacement?.disposition, 'cancelled');
    const repriced = replacePendingEvmProof(storage, original, { kind: 'hash', hash: hashC }, {
      disposition: 'repriced', previousHash: hashA, transactionHash: hashC, verified: true,
    })!;
    assert.equal(repriced.replacement?.disposition, 'cancelled');
    storage.failWrites = false;
    assert.equal(await retryPendingEvmProofPersistence(storage), 1);
    assert.equal(readPendingEvmRecord(storage, identity)!.replacement?.disposition, 'cancelled');
    assert.equal(removePendingEvmRecord(storage, repriced), true);
  }

  // A newer durable observer keeps its hash, but cannot erase a cancellation
  // already observed by this document while its persistence was unavailable.
  {
    const { identity, key, reservation, storage } = fixture();
    const original = finalizePendingEvmRecord(storage, reservation, { kind: 'hash', hash: hashA })!.record;
    storage.failWrites = true;
    replacePendingEvmProof(storage, original, { kind: 'hash', hash: hashB }, {
      disposition: 'cancelled', previousHash: hashA, transactionHash: hashB, verified: true,
    });
    const newer = { ...original, proof: { kind: 'hash' as const, hash: hashC } };
    storage.values.set(key, JSON.stringify(newer));
    storage.failWrites = false;
    assert.equal(await retryPendingEvmProofPersistence(storage), 1);
    const merged = readPendingEvmRecord(storage, identity)!;
    assert.deepEqual(merged.proof, newer.proof);
    assert.equal(merged.replacement?.disposition, 'cancelled');
    assert.equal(removePendingEvmRecord(storage, merged), true);
  }

  // Canonical terminal outcomes may remove the exact queued proof's blocker.
  for (const disposition of ['repriced', 'superseded'] as const) {
    const { key, reservation, storage } = fixture();
    const original = finalizePendingEvmRecord(storage, reservation, { kind: 'hash', hash: hashA })!.record;
    storage.failWrites = true;
    const terminal = replacePendingEvmProof(storage, original, { kind: 'hash', hash: hashB }, {
      disposition, previousHash: hashA, transactionHash: hashB, verified: true,
    })!;
    assert.equal(removePendingEvmRecord(storage, terminal), true);
    storage.failWrites = false;
    assert.equal(await retryPendingEvmProofPersistence(storage), 0);
    assert.equal(storage.getItem(key), null);
  }

  // A terminal deletion by another tab is authoritative, even though this
  // document has no corresponding storage event listener in this fixture.
  {
    const { key, reservation, storage } = fixture();
    storage.failProofWrites = true;
    finalizePendingEvmRecord(storage, reservation, { kind: 'hash', hash: hashA });
    storage.removeItem(key);
    storage.failProofWrites = false;
    assert.equal(await retryPendingEvmProofPersistence(storage), 0);
    assert.equal(storage.getItem(key), null);
  }

  // Retry uses the same ownership fences as acknowledgement and finalization.
  {
    const { reservation, storage } = fixture();
    storage.failProofWrites = true;
    const finalized = finalizePendingEvmRecord(storage, reservation, { kind: 'hash', hash: hashA })!;
    storage.failProofWrites = false;
    await withPendingEvmSubmissionLease(storage, reservation, async () => {
      assert.equal(await retryPendingEvmProofPersistence(storage), 0);
    });
    await withPendingEvmMonitorLease(storage, finalized.record, async () => {
      assert.equal(await retryPendingEvmProofPersistence(storage), 0);
    });
    assert.equal(await retryPendingEvmProofPersistence(storage), 1);
    assert.equal(removePendingEvmRecord(storage, finalized.record), true);
  }

  // A live receipt monitor can persist its queued proof without waiting for its
  // receipt or releasing ownership. Short ack/retry owners never opt into this.
  {
    const { key, reservation, storage } = fixture();
    storage.failProofWrites = true;
    const finalized = finalizePendingEvmRecord(storage, reservation, { kind: 'hash', hash: hashA })!;
    await withPendingEvmMonitorLease(storage, finalized.record, async (isCurrent) => {
      assert.equal(JSON.parse(storage.getItem(key)!).proof.kind, 'reservation');
      storage.failProofWrites = false;
      assert.equal(await retryPendingEvmProofPersistence(storage), 1);
      assert.deepEqual(JSON.parse(storage.getItem(key)!).proof, { kind: 'hash', hash: hashA });
      assert.equal(isCurrent(), true, 'persistence must retain the active receipt lease');
      assert.equal(await acknowledgePendingEvmRecord(
        storage, finalized.record, finalized.record.submittedAt + PENDING_EVM_HARD_LOCK_MS + 1,
      ), false, 'a live receipt owner still fences acknowledgement');
    }, { allowQueuedProofFlush: true });
    assert.equal(removePendingEvmRecord(storage, finalized.record), true);
  }

  // An opted-in monitor whose token was lost cannot act as the persistence
  // owner. The proof waits until ownership is safely acquired again.
  {
    const { key, reservation, storage } = fixture();
    storage.failProofWrites = true;
    const finalized = finalizePendingEvmRecord(storage, reservation, { kind: 'hash', hash: hashA })!;
    await withPendingEvmMonitorLease(storage, finalized.record, async (isCurrent) => {
      for (const candidate of storage.values.keys()) {
        if (candidate.includes(':monitor:')) storage.removeItem(candidate);
      }
      assert.equal(isCurrent(), false);
      storage.failProofWrites = false;
      assert.equal(await retryPendingEvmProofPersistence(storage), 0);
      assert.equal(JSON.parse(storage.getItem(key)!).proof.kind, 'reservation');
    }, { allowQueuedProofFlush: true });
    assert.equal(await retryPendingEvmProofPersistence(storage), 1);
    assert.equal(removePendingEvmRecord(storage, finalized.record), true);
  }

  // Existing v2 legacy proofs gain no invented original transaction provenance.
  {
    const { identity, key, reservation, storage } = fixture();
    const legacy = finalizePendingEvmRecord(storage, reservation, { kind: 'hash', hash: hashA })!.record;
    delete legacy.initialTransactionHash;
    storage.setItem(key, JSON.stringify(legacy));
    const replaced = replacePendingEvmProof(storage, legacy, { kind: 'hash', hash: hashB }, {
      disposition: 'repriced', previousHash: hashA, transactionHash: hashB,
    }) as PendingEvmRecord;
    assert.equal(replaced.initialTransactionHash, undefined);
    assert.equal(readPendingEvmRecord(storage, identity)!.initialTransactionHash, undefined);
    assert.equal(removePendingEvmRecord(storage, replaced), true);
  }

  // Web Locks and the fallback leases follow the same submission->monitor
  // order. This mock exercises the native branch's ifAvailable contract.
  {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const activeLocks = new Set<string>();
    const requestedLocks: string[] = [];
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { locks: { request: async (
        name: string, _options: unknown, callback: (lock: object | null) => Promise<unknown>,
      ) => {
        requestedLocks.push(name);
        if (activeLocks.has(name)) return callback(null);
        activeLocks.add(name);
        try { return await callback({ name }); } finally { activeLocks.delete(name); }
      } } },
    });
    try {
      const { reservation, storage } = fixture();
      assert.equal(await acknowledgePendingEvmRecord(storage, reservation), true);
      assert.equal(requestedLocks.length, 2);
      assert.match(requestedLocks[0], /:lease:/);
      assert.match(requestedLocks[1], /:monitor:/);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  }

  // Losing the submission claim during monitor acquisition fences deletion.
  {
    const { key, reservation, storage: sourceStorage } = fixture();
    class LostSubmissionLeaseStorage extends MemoryStorage {
      sabotage = true;
      override setItem(nextKey: string, value: string) {
        super.setItem(nextKey, value);
        if (this.sabotage && nextKey.includes(':monitor:')) {
          for (const candidate of this.values.keys()) {
            if (candidate.includes(':lease:')) this.values.delete(candidate);
          }
        }
      }
    }
    const storage = new LostSubmissionLeaseStorage();
    storage.values = new Map(sourceStorage.values);
    assert.equal(await acknowledgePendingEvmRecord(storage, reservation), false);
    assert.notEqual(storage.getItem(key), null);
    storage.sabotage = false;
    assert.equal(await acknowledgePendingEvmRecord(storage, reservation), true);
  }
  console.log('Pending proof recovery smoke passed.');
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
