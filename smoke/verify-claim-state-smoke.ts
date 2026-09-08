import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  advanceVerifyClaimRecord,
  canResumeVerifyClaimBeforeSubmission,
  canResumeStaleVerifyClaimReservation,
  createVerifyClaimReservation,
  createVerifyClaimRetryAttempt,
  getVerifyClaimPairState,
  readVerifyClaimJSON,
  resumeVerifyClaimPairBeforeSubmission,
  reserveVerifyClaimPair,
  VERIFY_CLAIM_RESERVED_LEASE_MS,
  writeVerifyClaimPair,
} from '../lib/verify-claim-records';

class FakeRedis {
  readonly values = new Map<string, unknown>();
  failReads = false;
  failWrites = false;

  async get(key: string): Promise<unknown> {
    if (this.failReads) throw new Error('redis unavailable');
    return this.values.get(key) ?? null;
  }

  async eval(script: string, keys: string[], args: string[]): Promise<number> {
    if (this.failWrites) throw new Error('redis unavailable');
    if (script.includes("redis.call('EXISTS'")) {
      if (keys.some((key) => this.values.has(key))) return 0;
    } else if (script.includes('ARGV[6]')) {
      const records = keys.map((key) => {
        const raw = this.values.get(key);
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      });
      if (records.some((record) => (
        record?.reservationId !== args[1]
        || record?.attemptId !== args[2]
        || record?.status !== args[3]
        || record?.stage !== args[4]
      ))) return 0;
      if (args[5] && records.some((record) => record?.updatedAt > Number(args[5]))) return 0;
      if (
        records[0]?.verificationToken !== records[1]?.verificationToken
        || records[0]?.userAddress !== records[1]?.userAddress
        || records[0]?.provider !== records[1]?.provider
        || records[0]?.strainId !== records[1]?.strainId
        || records[0]?.idempotencyKeys?.mint !== records[1]?.idempotencyKeys?.mint
        || records[0]?.idempotencyKeys?.transfer !== records[1]?.idempotencyKeys?.transfer
        || records[0]?.idempotencyKeys?.leafBonus !== records[1]?.idempotencyKeys?.leafBonus
        || records[0]?.idempotencyKeys?.seedBonus !== records[1]?.idempotencyKeys?.seedBonus
        || records[0]?.idempotencyKeys?.mint !== args[6]
        || records[0]?.idempotencyKeys?.transfer !== args[7]
        || records[0]?.idempotencyKeys?.leafBonus !== args[8]
        || records[0]?.idempotencyKeys?.seedBonus !== args[9]
      ) return 0;
    } else if (script.includes('claimRecord.reservationId')) {
      const records = keys.map((key) => {
        const raw = this.values.get(key);
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      });
      if (records.some((record) => (
        record?.reservationId !== args[1]
        || record?.attemptId !== args[2]
      ))) return 0;
    }
    for (const key of keys) this.values.set(key, args[0]);
    return 1;
  }
}

async function main() {
const input = {
  userAddress: '0x1111111111111111111111111111111111111111',
  verificationToken: 'verify-token',
  provider: 'x',
  strainId: 4,
};
const reservationId = '2e3f7f74-ea37-4e13-bba8-b9ca49e71de1';
const reservation = createVerifyClaimReservation(input, 1_000, reservationId);

assert.equal(reservation.reservationId, reservationId);
assert.equal(reservation.stage, 'reserved');
assert.match(reservation.attemptId, /^[0-9a-f-]{36}$/);
assert.equal('expiresAt' in reservation, false, 'claim reservations must not expire and silently reopen');
assert.equal(new Set(Object.values(reservation.idempotencyKeys)).size, 4);
for (const key of Object.values(reservation.idempotencyKeys)) {
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
}
assert.deepEqual(
  createVerifyClaimReservation(input, 2_000, reservationId).idempotencyKeys,
  reservation.idempotencyKeys,
  'recovery must reuse the CDP operation keys derived from the durable reservation',
);

const advanced = advanceVerifyClaimRecord(reservation, {
  reservationId: 'attacker-controlled-replacement',
  idempotencyKeys: {
    mint: 'bad',
    transfer: 'bad',
    leafBonus: 'bad',
    seedBonus: 'bad',
  },
  attemptId: 'attacker-controlled-attempt',
  stage: 'mint_submitting',
}, 3_000);
assert.equal(advanced.reservationId, reservationId);
assert.equal(advanced.attemptId, reservation.attemptId);
assert.deepEqual(advanced.idempotencyKeys, reservation.idempotencyKeys);

const store = new FakeRedis();
assert.deepEqual(await readVerifyClaimJSON('missing', store), { status: 'missing' });
store.failReads = true;
assert.equal((await readVerifyClaimJSON('missing', store)).status, 'unavailable');
store.failReads = false;

assert.equal((await reserveVerifyClaimPair('claim:a', 'wallet:a', reservation, store)).status, 'reserved');
assert.ok(store.values.has('claim:a'));
assert.ok(store.values.has('wallet:a'));
assert.equal((await reserveVerifyClaimPair('claim:a', 'wallet:b', reservation, store)).status, 'conflict');
assert.equal(store.values.has('wallet:b'), false, 'a pair conflict must not partially reserve another index');

const submitted = advanceVerifyClaimRecord(reservation, {
  stage: 'mint_submitted',
  mintUserOpHash: '0x1234',
});
assert.equal(await writeVerifyClaimPair('claim:a', 'wallet:a', submitted, store), true);
assert.equal(
  (await readVerifyClaimJSON<typeof submitted>('wallet:a', store)).status,
  'ok',
);
assert.equal(canResumeVerifyClaimBeforeSubmission(submitted), false);
assert.equal(getVerifyClaimPairState(submitted, submitted), 'manual_review');
const failedBeforeSubmission = advanceVerifyClaimRecord(reservation, {
  status: 'claim_failed_before_submission',
  stage: 'failed_before_submission',
  failedAt: 3_500,
  error: 'temporary setup failure',
});
assert.equal(await writeVerifyClaimPair('claim:a', 'wallet:a', failedBeforeSubmission, store), true);
assert.equal(canResumeVerifyClaimBeforeSubmission(failedBeforeSubmission), true);
assert.equal(getVerifyClaimPairState(failedBeforeSubmission, failedBeforeSubmission), 'retryable');
const resumed = createVerifyClaimRetryAttempt(
  failedBeforeSubmission,
  4_000,
  '7b673f18-3a73-4281-a13d-2c16048a72dd',
);
assert.equal(
  (await resumeVerifyClaimPairBeforeSubmission(
    'claim:a',
    'wallet:a',
    failedBeforeSubmission,
    resumed,
    4_000,
    store,
  )).status,
  'reserved',
);
assert.deepEqual(resumed.idempotencyKeys, reservation.idempotencyKeys);
assert.notEqual(resumed.attemptId, reservation.attemptId);
assert.equal(
  (await resumeVerifyClaimPairBeforeSubmission(
    'claim:a',
    'wallet:a',
    failedBeforeSubmission,
    resumed,
    4_000,
    store,
  )).status,
  'conflict',
  'only one concurrent retry may move a failed reservation back to reserved',
);
assert.equal(
  await writeVerifyClaimPair(
    'claim:a',
    'wallet:a',
    advanceVerifyClaimRecord(failedBeforeSubmission, { stage: 'mint_submitting' }, 4_001),
    store,
  ),
  false,
  'rotating the attempt lease must fence the original writer out',
);
const ambiguousFailure = advanceVerifyClaimRecord(failedBeforeSubmission, {
  mintUserOpHash: '0x1234',
});
assert.equal(
  canResumeVerifyClaimBeforeSubmission(ambiguousFailure),
  false,
  'any external operation identity must keep the claim in manual recovery',
);

const staleStore = new FakeRedis();
const staleReservation = createVerifyClaimReservation(input, 10_000, 'dd07b35e-7c9c-40dd-baf7-048961595830');
assert.equal((await reserveVerifyClaimPair('claim:stale', 'wallet:stale', staleReservation, staleStore)).status, 'reserved');
const beforeStale = 10_000 + VERIFY_CLAIM_RESERVED_LEASE_MS - 1;
assert.equal(canResumeStaleVerifyClaimReservation(staleReservation, beforeStale), false);
assert.equal(getVerifyClaimPairState(staleReservation, staleReservation, beforeStale), 'processing');
const staleAt = 10_000 + VERIFY_CLAIM_RESERVED_LEASE_MS;
assert.equal(canResumeStaleVerifyClaimReservation(staleReservation, staleAt), true);
assert.equal(getVerifyClaimPairState(staleReservation, staleReservation, staleAt), 'retryable');
const staleRetry = createVerifyClaimRetryAttempt(
  staleReservation,
  staleAt,
  'c7212ed6-c52c-4f51-a17f-73ed4df903d0',
);
assert.equal(
  (await resumeVerifyClaimPairBeforeSubmission(
    'claim:stale',
    'wallet:stale',
    staleReservation,
    staleRetry,
    staleAt,
    staleStore,
  )).status,
  'reserved',
);
assert.equal(
  await writeVerifyClaimPair(
    'claim:stale',
    'wallet:stale',
    advanceVerifyClaimRecord(staleReservation, { stage: 'mint_submitting' }, staleAt + 1),
    staleStore,
  ),
  false,
  'a stale handler must not cross the mint-submitting fence after takeover',
);
const retryMintFence = advanceVerifyClaimRecord(staleRetry, { stage: 'mint_submitting' }, staleAt + 1);
assert.equal(
  await writeVerifyClaimPair('claim:stale', 'wallet:stale', retryMintFence, staleStore),
  true,
);
assert.equal(
  canResumeStaleVerifyClaimReservation(
    advanceVerifyClaimRecord(staleReservation, { stage: 'mint_submitting' }, 10_000),
    staleAt + VERIFY_CLAIM_RESERVED_LEASE_MS,
  ),
  false,
  'mint_submitting is ambiguous forever even without an operation hash',
);
assert.equal(
  getVerifyClaimPairState(
    advanceVerifyClaimRecord(staleReservation, { stage: 'mint_submitting' }, 10_000),
    advanceVerifyClaimRecord(staleReservation, { stage: 'mint_submitting' }, 10_000),
    staleAt + VERIFY_CLAIM_RESERVED_LEASE_MS,
  ),
  'manual_review',
);
assert.equal(
  getVerifyClaimPairState(staleReservation, staleRetry, staleAt),
  'manual_review',
  'split attempt IDs must fail closed rather than look retryable',
);
const inconsistentPairStore = new FakeRedis();
inconsistentPairStore.values.set('claim:inconsistent', JSON.stringify(staleReservation));
inconsistentPairStore.values.set('wallet:inconsistent', JSON.stringify({
  ...staleReservation,
  idempotencyKeys: { ...staleReservation.idempotencyKeys, mint: 'different' },
}));
assert.equal(
  (await resumeVerifyClaimPairBeforeSubmission(
    'claim:inconsistent',
    'wallet:inconsistent',
    staleReservation,
    staleRetry,
    staleAt,
    inconsistentPairStore,
  )).status,
  'conflict',
  'atomic takeover must reject inconsistent operation identities',
);
const unrelatedReservation = createVerifyClaimReservation(input, 4_000, 'e841917a-874f-467d-adde-2183084cfb7e');
assert.equal(
  await writeVerifyClaimPair('claim:a', 'wallet:a', unrelatedReservation, store),
  false,
  'a transition must not overwrite records owned by another reservation',
);
store.failWrites = true;
assert.equal(await writeVerifyClaimPair('claim:a', 'wallet:a', reservation, store), false);

const routeSource = readFileSync(resolve(process.cwd(), 'app/api/verify/claim/route.ts'), 'utf8');
assert.match(routeSource, /idempotencyKey: record\.idempotencyKeys\.mint/);
assert.match(routeSource, /idempotencyKey: record\.idempotencyKeys\.transfer/);
assert.match(routeSource, /idempotencyKey: record\.idempotencyKeys\.leafBonus/);
assert.match(routeSource, /idempotencyKey: record\.idempotencyKeys\.seedBonus/);
assert.match(routeSource, /retryPairState = retryPairMatchesRequest[\s\S]*getVerifyClaimPairState\(retryClaimRecord, retryWalletRecord, retryStartedAt\)/);
assert.match(routeSource, /resumeVerifyClaimPairBeforeSubmission\(/);
assert.match(routeSource, /createVerifyClaimRetryAttempt\(retryClaimRecord/);
assert.doesNotMatch(routeSource, /VERIFY_CLAIM_RESERVATION_TTL_SECONDS/);
assert.doesNotMatch(routeSource, /redisDelRaw/);
assert.doesNotMatch(routeSource, /for \(let attempt/);

const checkRouteSource = readFileSync(resolve(process.cwd(), 'app/api/verify/check/route.ts'), 'utf8');
assert.match(checkRouteSource, /getVerifyClaimPairState\(claimRecord, walletRecord\)/);
assert.match(checkRouteSource, /claimState !== 'unclaimed' && claimState !== 'retryable'/);
const statusRouteSource = readFileSync(resolve(process.cwd(), 'app/api/verify/status/route.ts'), 'utf8');
assert.match(statusRouteSource, /getVerifyClaimPairState\(claimRecord, walletRecord\)/);
assert.match(statusRouteSource, /Claim status is temporarily unavailable/);
const componentSource = readFileSync(resolve(process.cwd(), 'components/verify-claim.tsx'), 'utf8');
assert.match(componentSource, /claimState === 'retryable'/);
assert.match(componentSource, /claimState === 'manual_review'/);
assert.match(componentSource, /setClaimState\(previous => previous === 'processing' \|\| previous === 'manual_review' \? previous : 'unavailable'\)/);

console.log('Verify claim state smoke passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
