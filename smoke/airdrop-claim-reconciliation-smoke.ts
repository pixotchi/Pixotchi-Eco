import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createClaimedAirdropRecord,
  createFailedAirdropClaimRecord,
  getAirdropOperationOutcome,
  isAirdropTransactionHash,
  isAirdropUserOperationHash,
} from '../lib/airdrop-claim-reconciliation';

const hash = `0x${'a'.repeat(64)}` as const;
const pendingRecord = {
  operationId: hash,
  seed: '1',
  status: 'pending' as const,
};

assert.equal(getAirdropOperationOutcome('broadcast'), 'pending');
assert.equal(getAirdropOperationOutcome('signed'), 'pending');
assert.equal(getAirdropOperationOutcome('failed'), 'failed');
assert.equal(getAirdropOperationOutcome('dropped'), 'failed');
assert.equal(getAirdropOperationOutcome('complete'), 'complete');
assert.equal(getAirdropOperationOutcome('unexpected'), 'unknown');
assert.equal(isAirdropUserOperationHash(hash), true);
assert.equal(isAirdropTransactionHash(hash), true);
assert.equal(isAirdropTransactionHash('0x1234'), false);

const claimed = createClaimedAirdropRecord(pendingRecord, hash, 123);
assert.equal(claimed.status, 'claimed');
assert.equal(claimed.claimed, true);
assert.equal(claimed.txHash, hash);
assert.equal(claimed.claimedAt, 123);

const failed = createFailedAirdropClaimRecord(pendingRecord, 456);
assert.equal(failed.status, 'failed');
assert.equal(failed.claimed, false);
assert.equal(failed.txHash, undefined);
assert.equal(failed.failureReason, 'Claim operation failed');

const statusRoute = readFileSync(
  new URL('../app/api/airdrop/status/route.ts', import.meta.url),
  'utf8',
);
assert.match(statusRoute, /getUserOperation\(\{ userOpHash: record\.operationId \}\)/);
assert.match(statusRoute, /getBaseTransactionReceipt\(operation\.transactionHash\)/);
assert.match(statusRoute, /redisCompareAndSetJSONRaw/);
assert.match(statusRoute, /enforceRateLimit\(req, \{/);
assert.match(statusRoute, /failClosed: true/);
assert.match(statusRoute, /scope: 'api:airdrop:status'/);
assert.match(statusRoute, /kind: 'ip'/);
assert.match(statusRoute, /kind: 'address'/);
assert.doesNotMatch(statusRoute, /sendUserOperation/);
assert.doesNotMatch(statusRoute, /attemptId: reconciled/);
assert.doesNotMatch(statusRoute, /operationId: reconciled/);

const claimRoute = readFileSync(
  new URL('../app/api/airdrop/claim/route.ts', import.meta.url),
  'utf8',
);
assert.match(claimRoute, /isAirdropUserOperationHash\(operationResult\?\.userOpHash\)/);
assert.doesNotMatch(claimRoute, /operationResult\?\.id/);
assert.doesNotMatch(claimRoute, /typeof operationResult === 'string'/);
assert.match(claimRoute, /getBaseTransactionReceipt\(receipt\.transactionHash\)/);
assert.match(claimRoute, /canonicalReceipt\.status !== 'success'/);
assert.match(claimRoute, /function parseAllocationAmount/);
assert.doesNotMatch(claimRoute, /parseFloat\(reservation\.(?:seed|leaf|pixotchi)/);
assert.match(claimRoute, /function persistExpectedEligibilityTransition/);
assert.match(claimRoute, /latestRecord\?: AirdropEligibilityRecord \| null/);
assert.match(claimRoute, /getAirdropRecordStatus\(err\.latestRecord\) === 'claimed'/);
assert.match(claimRoute, /getAirdropOperationOutcome\(receipt\.status\)/);
assert.match(claimRoute, /operationOutcome !== 'complete'/);
assert.doesNotMatch(
  claimRoute,
  /if \(receipt\.status !== 'complete'\)/,
  'an intermediate CDP response must stay pending rather than being recorded as failed',
);
assert.doesNotMatch(
  claimRoute,
  /redis\.set\(eligibilityKey/,
  'a slow POST must not overwrite status reconciliation with an unconditional write',
);
assert.doesNotMatch(
  claimRoute,
  /requires review before it can be retried/,
  'only ambiguous pending operations should block a fresh claim attempt',
);

console.log('Airdrop claim reconciliation smoke passed');
