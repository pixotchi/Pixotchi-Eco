import assert from 'node:assert/strict';
import type { Hex } from 'viem';
import { createPendingEvmCallsDigest, createPendingEvmRecord, type PendingEvmRecord } from '../lib/pending-evm-transaction';
import {
  TransactionCancelledError,
  TransactionSupersededError,
  TransactionVerificationUnavailableError,
  getPendingEvmReceiptTargets,
  verifyPendingEvmReceiptBinding,
  type TransactionBinding,
} from '../lib/transaction-proof-verification';
import { getErrorStatusName, isDefinitivePostSubmissionError, isUnresolvedWaitError } from '../lib/transaction-lifecycle';
import { isGameTransactionFailure } from '../lib/game-transaction-status';
import { getTransactionFeedback } from '../lib/transaction-feedback';

const account = `0x${'1'.repeat(40)}` as Hex;
const target = `0x${'2'.repeat(40)}` as Hex;
const other = `0x${'3'.repeat(40)}` as Hex;
const originalHash = `0x${'a'.repeat(64)}` as Hex;
const replacementHash = `0x${'b'.repeat(64)}` as Hex;
const call = { to: target, data: '0x1234' as Hex, value: BigInt(10) };
const transaction: TransactionBinding = { hash: replacementHash, from: account, to: target, input: call.data, value: call.value, chainId: 8453 };
const direct = () => createPendingEvmRecord({
  identity: { accountAddress: account, chainId: 8453, intentKey: 'proof-verification:direct' },
  callsDigest: createPendingEvmCallsDigest([call]), method: 'direct', proof: { kind: 'hash', hash: replacementHash },
});
const legacyDirect = () => {
  const record = direct();
  delete record.initialTransactionHash;
  return record;
};
const batch = () => createPendingEvmRecord({
  identity: { accountAddress: account, chainId: 8453, intentKey: 'proof-verification:batch' },
  callsDigest: createPendingEvmCallsDigest([call, call]), method: 'batch', connectorId: 'fixture', proof: { kind: 'calls', id: 'calls-id' },
});

async function main() {
  let reads = 0;
  const getTransaction = async () => { reads++; return transaction; };
  await verifyPendingEvmReceiptBinding({ record: direct(), transactionHash: replacementHash, getTransaction });
  assert.equal(reads, 0, 'a new unchanged wallet proof retains its original binding without extra RPC');
  await verifyPendingEvmReceiptBinding({ record: legacyDirect(), transactionHash: replacementHash, getTransaction });
  assert.equal(reads, 1, 'legacy direct success is checked against the persisted call digest');

  for (const changed of [{ to: other }, { input: '0x9999' as Hex }, { value: BigInt(11) }]) {
    await assert.rejects(verifyPendingEvmReceiptBinding({ record: legacyDirect(), transactionHash: replacementHash,
      getTransaction: async () => ({ ...transaction, ...changed }) }), TransactionSupersededError);
  }
  for (const data of [undefined, '0x' as Hex]) {
    const record = legacyDirect();
    record.callsDigest = createPendingEvmCallsDigest([{ to: target, data }]);
    await verifyPendingEvmReceiptBinding({ record, transactionHash: replacementHash,
      getTransaction: async () => ({ ...transaction, input: '0x', value: BigInt(0) }) });
  }
  await assert.rejects(verifyPendingEvmReceiptBinding({ record: legacyDirect(), transactionHash: replacementHash,
    getTransaction: async () => ({ ...transaction, from: other }) }), TransactionVerificationUnavailableError);
  await assert.rejects(verifyPendingEvmReceiptBinding({ record: legacyDirect(), transactionHash: replacementHash,
    getTransaction: async () => ({ ...transaction, chainId: 1 }) }), TransactionVerificationUnavailableError);

  const cannotRead = async (): Promise<TransactionBinding> => { throw new Error('Unexpected transaction lookup'); };
  for (const record of [direct(), batch()]) {
    for (const disposition of ['superseded', 'cancelled'] as const) {
      const restored: PendingEvmRecord = JSON.parse(JSON.stringify({ ...record,
        replacement: { disposition, previousHash: originalHash, transactionHash: replacementHash } }));
      await assert.rejects(verifyPendingEvmReceiptBinding({ record: restored, transactionHash: replacementHash, getTransaction: cannotRead }),
        disposition === 'superseded' ? TransactionSupersededError : TransactionCancelledError);
    }
  }
  const repriced = direct();
  repriced.initialTransactionHash = originalHash;
  repriced.replacement = { disposition: 'repriced', previousHash: originalHash, transactionHash: replacementHash };
  await verifyPendingEvmReceiptBinding({ record: repriced, transactionHash: replacementHash, getTransaction: cannotRead });
  delete repriced.initialTransactionHash;
  await assert.rejects(verifyPendingEvmReceiptBinding({ record: repriced, transactionHash: replacementHash,
    getTransaction: async () => ({ ...transaction, input: '0x9999' }) }), TransactionSupersededError,
  'repricing a legacy unverified hash must not establish missing original provenance');

  await verifyPendingEvmReceiptBinding({ record: batch(), transactionHash: replacementHash, getTransaction: cannotRead });
  const legacyBatch = batch();
  legacyBatch.proof = { kind: 'calls', id: 'calls-id', hash: replacementHash };
  assert.deepEqual(getPendingEvmReceiptTargets(legacyBatch, [originalHash]), [replacementHash]);
  const unaffectedHash = `0x${'c'.repeat(64)}` as Hex;
  assert.throws(() => getPendingEvmReceiptTargets(legacyBatch, [originalHash, unaffectedHash]), TransactionVerificationUnavailableError);
  await assert.rejects(verifyPendingEvmReceiptBinding({ record: legacyBatch, transactionHash: replacementHash,
    walletTransactionHashes: [replacementHash], getTransaction: cannotRead }), TransactionVerificationUnavailableError);
  await verifyPendingEvmReceiptBinding({ record: legacyBatch, transactionHash: replacementHash,
    walletTransactionHashes: [originalHash], getTransaction: async hash => ({ ...transaction, hash, from: other }) });
  await assert.rejects(verifyPendingEvmReceiptBinding({ record: legacyBatch, transactionHash: replacementHash,
    walletTransactionHashes: [originalHash], getTransaction: async hash => ({ ...transaction, hash, input: hash === originalHash ? '0x5678' : '0x1234' }) }), TransactionSupersededError);
  legacyBatch.replacement = { disposition: 'repriced', previousHash: originalHash, transactionHash: replacementHash };
  await assert.rejects(verifyPendingEvmReceiptBinding({ record: legacyBatch, transactionHash: replacementHash, getTransaction: cannotRead }), TransactionVerificationUnavailableError);
  legacyBatch.replacement.verified = true;
  assert.deepEqual(getPendingEvmReceiptTargets(legacyBatch, [originalHash, unaffectedHash]), [replacementHash, unaffectedHash],
    'a persisted replacement must not hide other batch receipts');
  assert.throws(() => getPendingEvmReceiptTargets({ ...legacyBatch, replacement: {
    ...legacyBatch.replacement!, transactionHash: unaffectedHash,
  } }, [originalHash, unaffectedHash]), TransactionVerificationUnavailableError,
  'a different stored proof cannot borrow an unrelated replacement mapping');
  await verifyPendingEvmReceiptBinding({ record: legacyBatch, transactionHash: replacementHash, getTransaction: cannotRead });

  assert.equal(getErrorStatusName(new TransactionSupersededError()), 'superseded');
  assert.equal(isDefinitivePostSubmissionError(new TransactionSupersededError()), true);
  assert.equal(isGameTransactionFailure('superseded'), true);
  assert.equal(isUnresolvedWaitError(new TransactionVerificationUnavailableError()), true);
  assert.equal(getTransactionFeedback({ statusName: 'superseded' })?.title, 'Action replaced in wallet');
  console.log('transaction proof verification smoke passed');
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
