import assert from 'node:assert/strict';
import { SiweMessage } from 'siwe';
import {
  resolveVerifyClaimPrincipal,
  VerifyClaimPrincipalError,
} from '../lib/verify-claim-principal';

const NOW_MS = Date.parse('2026-09-04T12:00:00.000Z');
const APP_URL = 'https://mini.pixotchi.tech';
const SIGNED_ADDRESS = '0x1111111111111111111111111111111111111111';

function makeMessage(overrides: Partial<SiweMessage> = {}) {
  return new SiweMessage({
    domain: 'mini.pixotchi.tech',
    address: SIGNED_ADDRESS,
    statement: 'Verify ownership of your X account to claim a free plant.',
    uri: APP_URL,
    version: '1',
    chainId: 8453,
    nonce: 'abcdefgh12345678',
    issuedAt: '2026-09-04T11:55:00.000Z',
    expirationTime: '2026-09-04T17:55:00.000Z',
    resources: [
      'urn:verify:provider:x',
      'urn:verify:action:claim_free_plant',
    ],
    ...overrides,
  }).prepareMessage();
}

const principal = resolveVerifyClaimPrincipal(makeMessage(), {
  claimedAddress: SIGNED_ADDRESS.toUpperCase().replace('0X', '0x'),
  claimedProvider: 'x',
  expectedAppUrl: APP_URL,
  nowMs: NOW_MS,
});
assert.deepEqual(principal, {
  address: SIGNED_ADDRESS,
  action: 'claim_free_plant',
  provider: 'x',
});

// New clients may omit the legacy unsigned assertions; the signed fields stay
// authoritative and produce the same principal.
assert.deepEqual(
  resolveVerifyClaimPrincipal(makeMessage(), {
    expectedAppUrl: APP_URL,
    nowMs: NOW_MS,
  }),
  principal,
);

assert.throws(
  () => resolveVerifyClaimPrincipal(makeMessage(), {
    claimedAddress: '0x2222222222222222222222222222222222222222',
    expectedAppUrl: APP_URL,
    nowMs: NOW_MS,
  }),
  (error) => error instanceof VerifyClaimPrincipalError
    && /does not match the signed SIWE principal/.test(error.message),
);

assert.throws(
  () => resolveVerifyClaimPrincipal(makeMessage(), {
    claimedProvider: 'coinbase',
    expectedAppUrl: APP_URL,
    nowMs: NOW_MS,
  }),
  /provider does not match/i,
);

assert.throws(
  () => resolveVerifyClaimPrincipal(makeMessage({ domain: 'evil.example' }), {
    expectedAppUrl: APP_URL,
    nowMs: NOW_MS,
  }),
  /Unexpected SIWE domain/,
);

assert.throws(
  () => resolveVerifyClaimPrincipal(makeMessage({ chainId: 1 }), {
    expectedAppUrl: APP_URL,
    nowMs: NOW_MS,
  }),
  /Base mainnet/,
);

assert.throws(
  () => resolveVerifyClaimPrincipal(makeMessage({
    resources: ['urn:verify:provider:x', 'urn:verify:action:another_action'],
  }), {
    expectedAppUrl: APP_URL,
    nowMs: NOW_MS,
  }),
  /invalid verification action/,
);

assert.throws(
  () => resolveVerifyClaimPrincipal(makeMessage({
    expirationTime: '2026-09-04T11:00:00.000Z',
  }), {
    expectedAppUrl: APP_URL,
    nowMs: NOW_MS,
  }),
  /expired/,
);

console.log('Verify claim SIWE principal binding smoke checks passed.');
