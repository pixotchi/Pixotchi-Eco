import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getBaseRpcRequestCost,
  isAnonymousBaseRpcMethodAllowed,
} from '../app/api/rpc/route';

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
