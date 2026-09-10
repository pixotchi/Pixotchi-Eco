import assert from 'node:assert/strict';
import { canRetryAirdropReservation, createAirdropReservation, getAirdropRecordStatus } from '../lib/airdrop-claim-state';
import { getAirdropRecovery } from '../lib/airdrop-execution';

const old = { seed: '1', status: 'pending' as const, attemptId: 'legacy', reservedAt: 1, reservationExpiresAt: 2 };
assert.equal(getAirdropRecordStatus(old), 'pending');
assert.equal(canRetryAirdropReservation(old, 48 * 3_600_000), false);
assert.equal(getAirdropRecovery(old).recoveryState, 'manual_review');
assert.throws(() => createAirdropReservation(old, Date.now(), 1_000));
assert.throws(() => createAirdropReservation({ status: 'failed' }, Date.now(), 1_000));
const fresh = createAirdropReservation({ seed: '1', status: 'eligible' }, 100, 1_000, () => 'new');
assert.equal(fresh.attemptId, 'new');
assert.equal(getAirdropRecovery({ ...old, claimed: true }).recoveryState, 'complete');
assert.equal(getAirdropRecovery({ ...old, operationId: `0x${'a'.repeat(64)}` }).retryAllowed, false);
console.log('Airdrop legacy reservation safety smoke passed');
