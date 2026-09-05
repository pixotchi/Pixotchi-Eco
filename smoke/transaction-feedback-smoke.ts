import assert from 'node:assert/strict';
import { friendlyTransactionError, getTransactionFeedback } from '../lib/transaction-feedback';

assert.equal(getTransactionFeedback({ statusName: 'idle' }), null);
assert.equal(getTransactionFeedback({ statusName: 'transactionPending' })?.title, 'Confirm in your wallet');
assert.equal(getTransactionFeedback({ statusName: 'transactionPending', hasProof: true })?.title, 'Transaction submitted');
for (const statusName of ['submissionAmbiguous', 'transactionUnresolved', 'transactionStale']) {
  const feedback = getTransactionFeedback({ statusName, hasProof: true, errorMessage: 'RPC timeout: private-provider-diagnostic' });
  assert.ok(feedback?.tone === 'warning' || feedback?.tone === 'progress');
  assert.doesNotMatch(JSON.stringify(feedback), /failed|canceled|private-provider-diagnostic|allow another|unlock|check your wallet/i);
  assert.notEqual(feedback?.icon, 'loading', 'uncertain states must not imply active progress with an endless spinner');
}
assert.equal(getTransactionFeedback({ statusName: 'transactionStale' })?.title, 'Confirmation delayed');
assert.equal(getTransactionFeedback({ statusName: 'confirmedSyncing', syncDelayed: true })?.title, 'Transaction confirmed');
assert.equal(getTransactionFeedback({ statusName: 'confirmedSyncing', syncDelayed: true })?.tone, 'warning');
assert.equal(getTransactionFeedback({ statusName: 'success' })?.tone, 'success');
assert.equal(getTransactionFeedback({ statusName: 'userRejected' })?.title, 'Action canceled');
assert.equal(getTransactionFeedback({ statusName: 'reverted' })?.tone, 'error');
assert.match(friendlyTransactionError('insufficient funds for gas'), /ETH/);
assert.match(friendlyTransactionError('insufficient balance'), /tokens/);
assert.match(friendlyTransactionError('atomic execution unsupported'), /wallet/);
assert.doesNotMatch(friendlyTransactionError('eth_sendRawTransaction -32000'), /eth_sendRawTransaction|-32000/);
console.log('Player transaction feedback smoke passed.');
