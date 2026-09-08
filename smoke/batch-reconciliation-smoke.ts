import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BatchReconciliation } from '../lib/batch-reconciliation';
import { getLandBuildingsBatch, getQuestSlotsBatch, type PixotchiReadClient } from '../lib/contracts';
import { onOwnerResourceInvalidation, reconcileOwnerResources } from '../lib/owner-resource-invalidation';

type Item = { id: string };
const key = (item: Item) => item.id;
const a = { id: 'land-1/building-0' };
const b = { id: 'land-2/building-3' };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

async function main() {
  const first = deferred<Item[]>();
  let calls = 0;
  const initial = new BatchReconciliation(async () => { calls += 1; return first.promise; }, key, () => {}, 'Retry scan');
  assert.throws(() => initial.assertReady([a]), /updating/, 'a first render is never actionable before a complete scan');
  const scan = initial.refresh();
  assert.equal(initial.refresh(), scan, 'simultaneous building refreshes share one read owner');
  assert.equal(calls, 1);
  first.resolve([a, b]);
  assert.equal(await scan, true);
  initial.assertReady([a]);
  assert.throws(() => initial.assertReady([]), /updating/, 'a fee-only bundle is never a valid batch');
  assert.throws(() => initial.assertReady([{ id: 'unowned' }]), /updating/);

  const reads: Array<{ minimumBlock?: bigint; result: ReturnType<typeof deferred<Item[]>> }> = [];
  const batch = new BatchReconciliation((minimumBlock) => {
    const result = deferred<Item[]>();
    reads.push({ minimumBlock, result });
    return result.promise;
  }, key, () => {}, 'Retry scan');
  const seed = batch.refresh();
  reads[0].result.resolve([a, b]);
  await seed;
  const beforeReceipt = batch.refresh();
  batch.retire([a], BigInt(100));
  assert.deepEqual(batch.state.items, [b], 'confirmed IDs retire synchronously, before a post-receipt read');
  assert.equal(batch.state.ready, false);
  assert.throws(() => batch.assertReady([b]), /updating/, 'even the next batch stays gated during reconciliation');
  assert.equal(batch.refresh(BigInt(100)), beforeReceipt, 'the receipt joins an existing read instead of racing it');
  reads[1].result.resolve([a, b]);
  await nextTurn();
  assert.equal(reads.length, 3, 'an earlier read is invalidated and followed by one receipt-aware read');
  assert.equal(reads[2].minimumBlock, BigInt(100));
  assert.equal(batch.state.ready, false, 'the old read cannot briefly reenable actions');
  reads[2].result.reject(new Error('RPC unavailable'));
  assert.equal(await beforeReceipt, false);
  assert.deepEqual(batch.state.items, [b], 'a failed reconciliation cannot restore confirmed IDs');
  assert.equal(batch.state.error, 'Retry scan');
  assert.throws(() => batch.assertReady([b]), /updating/);

  const retry = batch.refresh();
  assert.equal(reads[3].minimumBlock, BigInt(100), 'retry retains the receipt lower bound');
  reads[3].result.resolve([a, b]);
  assert.equal(await retry, true);
  assert.deepEqual(batch.state.items, [b], 'the first successful read still suppresses the confirmed subset');
  batch.assertReady([b]);
  assert.throws(() => batch.assertReady([a]), /updating/);
  const laterCycle = batch.refresh();
  reads[4].result.resolve([a, b]);
  await laterCycle;
  batch.assertReady([a]); // Later production/quest cycles can become eligible again.

  // Farmer slots become active rather than disappearing from the census.
  type Farmer = { slot: number; state: 'available' | 'in_progress' };
  const idle: Farmer = { slot: 0, state: 'available' };
  const active: Farmer = { slot: 0, state: 'in_progress' };
  let farmerRows = [idle];
  const farmers = new BatchReconciliation(async () => farmerRows, (farmer) => `${farmer.slot}/${farmer.state}`, () => {}, 'Retry farmers');
  await farmers.refresh();
  farmers.retire([idle], BigInt(100));
  farmerRows = [active];
  await farmers.refresh();
  assert.deepEqual(farmers.state.items, [active], 'confirmed farmers remain visible as on adventure');
  assert.throws(() => farmers.assertReady([idle]), /updating/);

  const oldWalletRead = deferred<Item[]>();
  let publishes = 0;
  const oldWallet = new BatchReconciliation(() => oldWalletRead.promise, key, () => { publishes += 1; }, 'Retry');
  const oldJob = oldWallet.refresh();
  oldWallet.dispose();
  const beforeLateResult = publishes;
  oldWalletRead.resolve([a]);
  assert.equal(await oldJob, false);
  assert.equal(publishes, beforeLateResult, 'a late wallet/holdings response cannot publish after cleanup');
  const newWallet = new BatchReconciliation(async () => [b], key, () => {}, 'Retry');
  assert.throws(() => newWallet.assertReady([a]), /updating/);
  await newWallet.refresh();
  assert.deepEqual(newWallet.state.items, [b]);
  newWallet.dispose();
  assert.throws(() => newWallet.assertReady([b]), /updating/, 'late pre-submit work cannot use a disposed wallet census');

  // Prove the real owner dispatcher treats a false scan result as reconciliation
  // failure; no exception adapter is needed to keep confirmation retryable.
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const testWindow = Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow });
  let removeListener: (() => void) | undefined;
  try {
    let failOwnerRead = true;
    const canonicalBatch = new BatchReconciliation(async () => {
      if (failOwnerRead) throw new Error('RPC failed');
      return [b];
    }, key, () => {}, 'Retry scan');
    removeListener = onOwnerResourceInvalidation(() => canonicalBatch.refresh(), ['buildings']);
    assert.equal(await reconcileOwnerResources({ domains: ['buildings'], transactionId: 'failed-batch-scan' }), false);
    failOwnerRead = false;
    assert.equal(await reconcileOwnerResources({ domains: ['buildings'], transactionId: 'retry-batch-scan' }), true);
  } finally {
    removeListener?.();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }

  // Exercise the actual multicall helpers: every chunk must use the same block.
  const requestedBlocks: Array<bigint | undefined> = [];
  const readClient = {
    multicall: async (request: { blockNumber?: bigint; contracts: unknown[] }) => {
      requestedBlocks.push(request.blockNumber);
      return request.contracts.map(() => ({ status: 'success', result: [] }));
    },
  } as unknown as PixotchiReadClient;
  await getLandBuildingsBatch([BigInt(1), BigInt(2)], { chunkSize: 1, readClient, requireComplete: true, blockNumber: BigInt(123) });
  await getQuestSlotsBatch([BigInt(1), BigInt(2)], { chunkSize: 1, readClient, blockNumber: BigInt(123) });
  assert.deepEqual(requestedBlocks, [BigInt(123), BigInt(123), BigInt(123), BigInt(123)]);

  // Integration guards complement behavioral coordinator tests: both production
  // callers must retire at confirmation and join canonical building refreshes.
  for (const file of ['batch-claim-card.tsx', 'batch-quest-start-card.tsx']) {
    const source = readFileSync(new URL(`../components/transactions/${file}`, import.meta.url), 'utf8');
    assert.match(source, /confirmedSyncing[\s\S]*coordinator\.retire/);
    assert.match(source, /coordinator\.assertReady/);
    assert.match(source, /disabled=\{!scanReady/);
    assert.match(source, /effects=\{\{ domains: \["buildings", "lands", "balances"/);
    assert.doesNotMatch(source, /txKey|setTxKey|dispatchPostTransactionRefresh|window\.dispatchEvent/);
    assert.match(source, /getBlockNumber\(\{ cacheTime: 0 \}\)/);
    assert.match(source, /currentBlock < minimumBlock/);
    assert.match(source, /blockNumber: currentBlock/);
  }
  const hook = readFileSync(new URL('../hooks/useBatchReconciliation.ts', import.meta.url), 'utf8');
  assert.match(hook, /snapshot\?\.coordinator === coordinator/, 'replacement readers cannot reuse a ready snapshot from the same owner string');
  console.log('Batch reconciliation smoke passed (read coalescing, receipt ordering, failure recovery, retired IDs, owner cleanup, pinned multicalls).');
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
