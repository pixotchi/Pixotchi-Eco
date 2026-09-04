import assert from 'node:assert/strict';
import {
  canRetryAirdropReservation,
  createAirdropReservation,
  getAirdropRecordStatus,
} from '../lib/airdrop-claim-state';

const now = 10_000;
const stalePending = {
  attemptId: 'attempt-stable',
  reservationExpiresAt: now - 1,
  seed: '1',
  status: 'pending' as const,
};

assert.equal(getAirdropRecordStatus(stalePending), 'pending');
assert.equal(canRetryAirdropReservation(stalePending, now), true);

const retry = createAirdropReservation(stalePending, now, 1_000, () => 'must-not-be-used');
assert.equal(retry.attemptId, 'attempt-stable', 'an ambiguous retry must preserve its CDP idempotency key');
assert.equal(retry.status, 'pending');
assert.equal(retry.reservationExpiresAt, now + 1_000);

const fresh = createAirdropReservation({ seed: '1', status: 'eligible' }, now, 1_000, () => 'attempt-new');
assert.equal(fresh.attemptId, 'attempt-new');

const retryAfterTerminalFailure = createAirdropReservation(
  { attemptId: 'attempt-failed', operationId: `0x${'f'.repeat(64)}`, seed: '1', status: 'failed' },
  now,
  1_000,
  () => 'attempt-retry',
);
assert.equal(retryAfterTerminalFailure.attemptId, 'attempt-retry');
assert.equal(retryAfterTerminalFailure.operationId, undefined);
assert.equal(
  retryAfterTerminalFailure.status,
  'pending',
  'a canonical failed operation is unpaid and must begin a new idempotent attempt',
);

assert.equal(
  canRetryAirdropReservation({ ...stalePending, operationId: '0x123' }, now),
  false,
  'a broadcast operation must be reconciled, not re-dispatched',
);
assert.equal(getAirdropRecordStatus({ status: 'failed' }), 'failed');

console.log('Airdrop claim state smoke passed');
