import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getBaseRpcRequestCost,
  isAnonymousBaseRpcMethodAllowed,
  isAnonymousBaseRpcRequestAllowed,
} from '../app/api/rpc/route';
import {
  getPaymentStorageSlot,
  LEAF_REWARD_ADDRESS_SLOT_OFFSET,
  SEED_REWARD_ADDRESS_SLOT_OFFSET,
} from '../lib/quest-reward-storage';

const routeSource = readFileSync(
  new URL('../app/api/rpc/route.ts', import.meta.url),
  'utf8',
);

// First-load wallet connection must work without a chat/session cookie, but the
// anonymous tier must not grow back into the complete provider-method allowlist.
for (const method of [
  'eth_chainId',
  'eth_call',
  'eth_getBalance',
  'eth_getLogs',
  'eth_getTransactionReceipt',
]) {
  assert.equal(isAnonymousBaseRpcMethodAllowed(method), true, `${method} must support pre-auth wallet reads`);
}
for (const method of ['eth_getStorageAt', 'debug_traceCall', 'web3_clientVersion']) {
  assert.equal(isAnonymousBaseRpcMethodAllowed(method), false, `${method} must not be anonymously relayed`);
}

const allowedRewardSourceRequest = {
  id: 2,
  jsonrpc: '2.0',
  method: 'eth_getStorageAt',
  params: [
    process.env.NEXT_PUBLIC_LAND_CONTRACT_ADDRESS_MAINNET
      || '0x3f1F8F0C4BE4bCeB45E6597AFe0dE861B8c3278c',
    getPaymentStorageSlot(SEED_REWARD_ADDRESS_SLOT_OFFSET),
    'latest',
  ],
};

assert.equal(
  isAnonymousBaseRpcRequestAllowed({ id: 1, jsonrpc: '2.0', method: 'eth_chainId', params: [] }),
  true,
);
assert.equal(
  isAnonymousBaseRpcRequestAllowed(allowedRewardSourceRequest),
  true,
  'the exact live Farmer House reward-source read must work before/after chat-session expiry',
);
assert.equal(
  isAnonymousBaseRpcRequestAllowed({
    ...allowedRewardSourceRequest,
    params: [
      allowedRewardSourceRequest.params[0],
      getPaymentStorageSlot(LEAF_REWARD_ADDRESS_SLOT_OFFSET),
    ],
  }),
  true,
  'the default latest-state form must support the second reward source slot',
);
assert.equal(
  isAnonymousBaseRpcRequestAllowed({
    ...allowedRewardSourceRequest,
    params: [allowedRewardSourceRequest.params[0], `0x${'00'.repeat(32)}`, 'latest'],
  }),
  false,
  'arbitrary contract storage must remain outside the anonymous tier',
);
assert.equal(
  isAnonymousBaseRpcRequestAllowed({
    ...allowedRewardSourceRequest,
    params: [allowedRewardSourceRequest.params[0], allowedRewardSourceRequest.params[1], '0x123'],
  }),
  false,
  'historical storage reads must remain outside the anonymous tier',
);
assert.equal(
  isAnonymousBaseRpcRequestAllowed({
    ...allowedRewardSourceRequest,
    params: [
      '0x0000000000000000000000000000000000000001',
      allowedRewardSourceRequest.params[1],
      'latest',
    ],
  }),
  false,
  'the same storage slots on another contract must remain outside the anonymous tier',
);
assert.equal(
  [
    { id: 1, jsonrpc: '2.0', method: 'eth_chainId', params: [] },
    allowedRewardSourceRequest,
  ].every((request) => isAnonymousBaseRpcRequestAllowed(request)),
  true,
  'a public read batched with the Farmer House storage read must remain eligible',
);

assert.equal(getBaseRpcRequestCost('eth_getLogs'), 16);
assert.equal(getBaseRpcRequestCost('eth_call'), 2);
assert.equal(getBaseRpcRequestCost('eth_estimateGas'), 2);
assert.equal(getBaseRpcRequestCost('eth_chainId'), 1);

// Origin is browser CSRF metadata, not non-browser identity. A session/Quick
// Auth identity upgrades the tier, while anonymous traffic is limited both by a
// shared bucket and a bounded forwarded-IP bucket.
assert.match(routeSource, /getChatSessionOrQuickAuthFromRequest/);
assert.match(routeSource, /rpc:rate:authenticated:address:/);
assert.match(routeSource, /rpc:rate:anonymous:global:/);
assert.match(routeSource, /unauthenticated script can forge both headers/);
assert.match(routeSource, /redisIncrBy\(key, cost\)/);
assert.match(routeSource, /redisExpire\(key, RATE_LIMIT_WINDOW_SECONDS \+ 5\)/);
assert.match(routeSource, /if \(isProduction\(\)\) return \{ status: 'unavailable' \};/);
assert.match(routeSource, /Rate limiting is temporarily unavailable/);
assert.match(routeSource, /requires an authenticated session/);

console.log('rpc access hardening smoke passed');
