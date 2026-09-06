import assert from 'node:assert/strict';
import { decodeFunctionResult, encodeFunctionResult, type Hex } from 'viem';
import { landAbi } from '../public/abi/pixotchi-v3-abi';
import { isPendingEvmEffects, normalizePendingEffects } from '../lib/pending-evm-effects';
import { getBatchTransactionHashes, hasWalletBatchResolution, parseWalletBatchStatus, parseWalletCallsId, WalletStatusUnavailableError } from '../lib/wallet-batch-status';
import { isUnresolvedWaitError } from '../lib/transaction-lifecycle';
import { parseLandLeaderboard, rankLands } from '../lib/land-ranking';
import { createPendingEvmRecord, getPendingEvmStorageKey, readPendingEvmRecord, listPendingEvmRecords, removePendingEvmRecord, replacePendingEvmProof, writePendingEvmRecord, withPendingEvmSubmissionGuard, resumePendingEvmRecord, type PendingEvmStorage } from '../lib/pending-evm-transaction';

const hash: Hex = `0x${'a'.repeat(64)}`;
const nextHash: Hex = `0x${'b'.repeat(64)}`;
const identity = { accountAddress: `0x${'1'.repeat(40)}`, chainId: 8453, intentKey: 'frontend:recovery' };
const badEffects: unknown[] = [false, [], { domains: ['other'] },
  ...[-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '2', []].map(value => ({ domains: ['plants'], expected: { plantCountAtLeast: value } })),
  ...[['2'], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1], 1].map(value => ({ domains: ['plants'], expected: { plantIdsPresent: value } })),
  ...[['1x'], ['1.5'], ['-1'], ['0x10'], [''], [true], 1].map(value => ({ domains: ['lands'], expected: { landIdsAbsent: value } })),
  { domains: ['lands'], expected: { unknown: [] } },
];
for (const effects of badEffects) assert.equal(isPendingEvmEffects(effects), false);
assert.equal(isPendingEvmEffects({ domains: ['lands', 'plants'], expected: { plantIdsPresent: [0, 123], landIdsAbsent: ['900719925474099300000'], landCountAtLeast: 0 } }), true);
assert.deepEqual(normalizePendingEffects({ domains: ['lands', 'lands'], expected: { landIdsAbsent: [BigInt('900719925474099300000')] } }), { domains: ['lands'], expected: { landIdsAbsent: ['900719925474099300000'] } });

function memoryStorage(): PendingEvmStorage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); }, key: index => [...values.keys()][index] ?? null, get length() { return values.size; } };
}

async function main() {
  assert.deepEqual(parseLandLeaderboard([]), []);
  const contractRows = [
    { landId: BigInt(1), experiencePoints: BigInt('1000000000000000000001'), name: '' },
    { landId: BigInt(2), experiencePoints: BigInt('1000000000000000000002'), name: 'Meadow' },
  ];
  const encoded = encodeFunctionResult({ abi: landAbi, functionName: 'getLeaderboard', result: contractRows });
  const decoded = decodeFunctionResult({ abi: landAbi, functionName: 'getLeaderboard', data: encoded });
  const parsed = parseLandLeaderboard(decoded);
  assert.deepEqual(parsed, contractRows.map(row => ({ ...row, landId: Number(row.landId) })));
  assert.deepEqual(parseLandLeaderboard(contractRows.map(row => [row.landId, row.experiencePoints.toString(), row.name])), parsed);
  assert.deepEqual(rankLands(parsed).map(row => row.landId), [2, 1]);
  assert.equal(rankLands(parsed)[1].name, 'Land #1');
  for (const value of [null, {}, [null], [[true, 0, '']], [[Number.MAX_SAFE_INTEGER + 1, 0, '']], [[1, -1, '']], [[1, 0, null]], [{ landId: 1, name: 'Missing XP' }], [[1, 0, ''], []]]) assert.throws(() => parseLandLeaderboard(value));
  for (const effects of badEffects) {
    const storage = memoryStorage();
    const record = createPendingEvmRecord({ callsDigest: hash, identity, method: 'direct', proof: { kind: 'hash', hash } });
    assert.equal(writePendingEvmRecord(storage, record), true);
    const key = storage.key!(0)!;
    const corrupt = JSON.stringify({ ...record, effects });
    storage.setItem(key, corrupt);
    const recovered = readPendingEvmRecord(storage, identity);
    assert.ok(recovered);
    assert.deepEqual(recovered.proof, record.proof);
    assert.equal(recovered.effects, undefined);
    assert.equal(storage.getItem(key), corrupt, 'read must not rewrite evidence');
    let sends = 0;
    const guarded = await withPendingEvmSubmissionGuard(storage, identity, async () => ++sends);
    assert.equal(guarded.acquired && guarded.value.submitted, false);
    assert.equal(sends, 0, 'damaged metadata must not allow a second send');
    assert.deepEqual(listPendingEvmRecords(storage, { ...identity, accountAddress: `0x${'2'.repeat(40)}` }), []);
    assert.deepEqual(listPendingEvmRecords(storage, { ...identity, chainId: 1 }), []);
    assert.equal(readPendingEvmRecord(storage, identity)?.attemptId, record.attemptId);
    const replaced = replacePendingEvmProof(storage, recovered, { kind: 'hash', hash: nextHash });
    assert.ok(replaced, 'sanitized metadata must not prevent canonical replacement');
    assert.equal(removePendingEvmRecord(storage, recovered), false, 'old proof must not clear replacement');
    let monitored: unknown;
    await resumePendingEvmRecord(replaced, { waitForReceipt: async value => { monitored = value; return {}; }, waitForCallsStatus: async () => { throw new Error('Wrong monitor'); } });
    assert.equal(monitored, nextHash);
    assert.equal(removePendingEvmRecord(storage, replaced), true);
  }
  // Owner mismatches at a logical migration key cannot become a local recovery proof.
  const storage = memoryStorage();
  const other = createPendingEvmRecord({ callsDigest: hash, identity: { ...identity, accountAddress: `0x${'2'.repeat(40)}` }, method: 'direct', proof: { kind: 'hash', hash } });
  storage.setItem(getPendingEvmStorageKey(identity), JSON.stringify(other));
  assert.equal(readPendingEvmRecord(storage, identity), null);
  assert.equal(parseWalletCallsId({ id: 'call-123' }), 'call-123');
  for (const value of [null, [], { id: 1 }, { id: ' ' }, { id: 'a'.repeat(513) }]) assert.equal(parseWalletCallsId(value), undefined);
  const success = { status: 'success', statusCode: 200, chainId: 8453, receipts: [{ transactionHash: hash }, { transactionHash: nextHash }, { transactionHash: hash }] };
  assert.deepEqual(getBatchTransactionHashes(parseWalletBatchStatus(success, 8453)), [hash, nextHash]);
  assert.equal(parseWalletBatchStatus({ status: 'failure', statusCode: 600, receipts: [] }, 8453).status, 'failure');
  assert.equal(parseWalletBatchStatus({ status: 'success' }, 8453).receipts.length, 0, 'success without hash still requires canonical evidence');
  assert.equal(hasWalletBatchResolution(parseWalletBatchStatus({ status: 'success' }, 8453)), false);
  assert.equal(hasWalletBatchResolution(parseWalletBatchStatus({ status: 'pending', statusCode: 100, receipts: [{ transactionHash: hash }] }, 8453)), false, 'pending with a hash must not be reported as reverted');
  assert.equal(hasWalletBatchResolution(parseWalletBatchStatus(success, 8453)), true);
  for (const value of [null, [], {}, { ...success, chainId: 1 }, { ...success, statusCode: 500 }, { ...success, statusCode: Number.NaN }, { ...success, atomic: 'true' }, { ...success, receipts: {} }, { ...success, receipts: [{ transactionHash: '0x123' }] }, { ...success, receipts: [...success.receipts, null] }]) {
    assert.throws(() => parseWalletBatchStatus(value, 8453), WalletStatusUnavailableError);
  }
  assert.equal(isUnresolvedWaitError(new WalletStatusUnavailableError()), true);
  console.log('Frontend recovery smoke passed: malformed metadata preserves locks/proofs; owner/chain isolation; replacement and status validation.');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
