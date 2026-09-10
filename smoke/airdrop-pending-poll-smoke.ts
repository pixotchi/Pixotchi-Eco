import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AIRDROP_PENDING_POLL_MAX_ATTEMPTS,
    getAirdropPendingPollDelay,
    shouldPollAirdropStatus,
} from '../lib/airdrop-claim-polling';

assert.equal(AIRDROP_PENDING_POLL_MAX_ATTEMPTS, 8);
assert.equal(getAirdropPendingPollDelay(0, 0.5), 5_000);
assert.equal(getAirdropPendingPollDelay(1, 0.5), 10_000);
assert.equal(getAirdropPendingPollDelay(0, 0), 4_000);
assert.equal(getAirdropPendingPollDelay(0, 1), 6_000);
assert.equal(getAirdropPendingPollDelay(99, 0.5), 60_000);
assert.equal(getAirdropPendingPollDelay(99, 1), 60_000);
assert.equal(shouldPollAirdropStatus({ status: 'pending', recoveryState: 'manual_review', retryAllowed: false }), false);
assert.equal(shouldPollAirdropStatus({ status: 'pending', recoveryState: 'retryable', retryAllowed: true }), false);
assert.equal(shouldPollAirdropStatus({ status: 'pending', recoveryState: 'processing', retryAllowed: false }), true);
assert.equal(shouldPollAirdropStatus({ status: 'claimed' }), false);

const card = readFileSync(
  new URL('../components/airdrop-claim-card.tsx', import.meta.url),
  'utf8',
);
assert.match(card, /document\.visibilityState !== 'visible'/);
assert.match(card, /document\.addEventListener\('visibilitychange', handleVisibilityChange\)/);
assert.match(card, /AIRDROP_PENDING_POLL_MAX_ATTEMPTS/);
assert.match(card, /Check status/);
assert.match(card, /if \(loading && !status\)/);
assert.doesNotMatch(card, /setLoading\(true\);\s*setStatus\(null\);/);

console.log('Airdrop pending-poll smoke passed');
