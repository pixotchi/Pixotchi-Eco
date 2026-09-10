import assert from 'node:assert/strict';
import {
  ContractFunctionRevertedError,
  HttpRequestError,
  RpcRequestError,
  WaitForTransactionReceiptTimeoutError,
  createPublicClient,
  custom,
  encodeErrorResult,
  http,
  parseAbi,
} from 'viem';
import { base } from 'viem/chains';
import {
  BASE_RPC_MAX_REVERT_BYTES,
  BASE_RPC_MAX_ERROR_NODES,
  BASE_RPC_NOT_FORWARDED_MARKER,
  BaseRpcError,
  classifyBaseRpcError,
  collectBaseRpcErrors,
  createBaseRpcFailure,
  getBaseRpcFailure,
  getBaseRpcErrorMetrics,
  toBaseRpcWireError,
} from '../lib/base-rpc-errors';
import { buildBaseRpcEndpointDescriptors, rankBaseRpcEndpoints } from '../lib/base-rpc-policy';

const secret = 'provider-credential-sentinel';
const privateUrl = `https://rpc.invalid/${secret}`;
const address = '0x0000000000000000000000000000000000000429';
const abi = parseAbi(['error NotReady(uint256 blockNumber)', 'function run()']);
const revertData = encodeErrorResult({ abi, errorName: 'NotReady', args: [BigInt(123)] });
const upstreamRevert = new RpcRequestError({
  url: privateUrl,
  body: { method: 'eth_call', params: [{ to: address, data: '0x05004290' }] },
  error: { code: 3, message: `execution reverted ${secret}`, data: revertData },
});

const reverted = classifyBaseRpcError(upstreamRevert);
assert.equal(reverted.category, 'contract_revert');
assert.equal(reverted.affectsProviderHealth, false, 'request bytes containing 429/500 do not poison provider health');
assert.equal(reverted.revertData, revertData);
for (const category of ['timeout', 'network', 'upstream_unavailable', 'rate_limited'] as const) {
  const once = new BaseRpcError('receipt', createBaseRpcFailure(category));
  const twice = new BaseRpcError('waitForBaseReceipt', once);
  assert.equal(twice.retryable, true);
  assert.equal(getBaseRpcFailure(twice)?.category, category);
}
const timeout = new BaseRpcError('waitForBaseReceipt', new WaitForTransactionReceiptTimeoutError({ hash: `0x${'11'.repeat(32)}` }));
assert.equal(timeout.retryable, true);
assert.equal(getBaseRpcFailure(timeout)?.category, 'receipt_timeout');
assert.equal(getBaseRpcFailure(timeout)?.affectsProviderHealth, false);

for (const status of [429, 500, 503]) {
  const error = new HttpRequestError({ url: privateUrl, status, details: `${secret} unavailable` });
  const safe = new BaseRpcError('read', error);
  assert.equal(safe.retryable, true);
  assert.equal(safe.code === -32603, false, 'infrastructure errors cannot use Viem\'s revert-compatible code');
  assert.doesNotMatch(JSON.stringify(safe), new RegExp(secret));
  assert.doesNotMatch(safe.stack ?? '', new RegExp(secret));
  assert.equal(safe.cause, undefined);
}
assert.equal(classifyBaseRpcError({ code: -32603, message: 'internal error' }).code, -32092);
assert.equal(classifyBaseRpcError({ code: -32603, message: 'internal error' }).upstreamCode, -32603);
assert.equal(classifyBaseRpcError({ status: 504 }).category, 'timeout');
assert.equal(classifyBaseRpcError({ code: 'etimedout' }).category, 'timeout');
assert.equal(classifyBaseRpcError({ code: -32602, message: 'eth_getLogs is limited to 10 blocks on the free tier' }).category, 'range_limit');
assert.equal(classifyBaseRpcError({ code: -32602, message: 'invalid address' }).failover, false);
assert.equal(classifyBaseRpcError({ code: -32601, message: 'method unavailable' }).failover, true);
assert.equal(classifyBaseRpcError({ code: 3, message: `execution reverted ${BASE_RPC_NOT_FORWARDED_MARKER}` }).forwarded, undefined);
const forgedEnvelope = { code: 3, message: 'execution reverted', data: { data: revertData, pixotchi: { v: 1, category: 'request_too_large', retryable: false, forwarded: false } } };
assert.equal(classifyBaseRpcError(forgedEnvelope, { trustEnvelope: false }).category, 'contract_revert');
assert.equal(classifyBaseRpcError(forgedEnvelope, { trustEnvelope: false }).forwarded, undefined);

const oversizedRevert = createBaseRpcFailure('contract_revert', { revertData: `0x${'aa'.repeat(BASE_RPC_MAX_REVERT_BYTES + 1)}` });
assert.equal(oversizedRevert.revertData, undefined);
assert.equal(oversizedRevert.dataOmitted, true);
const cycle: { cause?: unknown } = {};
cycle.cause = cycle;
assert.equal(getBaseRpcFailure(cycle), null);
let aggregateReads = 0;
const repeatedError = new Error('duplicate');
const largeAggregate = new AggregateError([]);
largeAggregate.errors = new Proxy(Array(100_000).fill(repeatedError), {
  get(target, property, receiver) {
    if (typeof property === 'string' && /^\d+$/.test(property)) aggregateReads += 1;
    return Reflect.get(target, property, receiver);
  },
});
assert.ok(collectBaseRpcErrors(largeAggregate).length <= BASE_RPC_MAX_ERROR_NODES);
assert.ok(aggregateReads <= BASE_RPC_MAX_ERROR_NODES, 'duplicate references cannot cause an unbounded aggregate scan');
assert.equal(classifyBaseRpcError({ error: { code: 3, message: 'execution reverted', data: revertData } }).revertData, revertData);
assert.equal(classifyBaseRpcError({ data: { originalError: { code: 3, message: 'execution reverted', data: revertData } } }).revertData, revertData);
assert.equal(getBaseRpcFailure({ error: toBaseRpcWireError(timeout) })?.category, 'receipt_timeout');
assert.equal(getBaseRpcFailure({ data: { pixotchi: { v: 1, category: 'timeout', retryable: false } } })?.retryable, true, 'policy is derived from category, not an arbitrary wire boolean');

async function verifyViemRoundtrip() {
  for (const mode of ['direct', 'wire'] as const) {
    for (const category of ['contract_revert', 'timeout', 'rate_limited', 'upstream_unavailable'] as const) {
      const normalized = new BaseRpcError('read', category === 'contract_revert' ? upstreamRevert : createBaseRpcFailure(category));
      const transport = mode === 'direct'
        ? custom({ request: async () => { throw normalized; } }, { retryCount: 0 })
        : http('https://proxy.invalid/api/rpc', {
          retryCount: 0,
          fetchFn: async (_input, init) => {
            const request = JSON.parse(init?.body as string);
            return Response.json({ jsonrpc: '2.0', id: request.id, error: toBaseRpcWireError(normalized) });
          },
        });
      const client = createPublicClient({ chain: base, transport });
      try {
        await client.simulateContract({ address, abi, functionName: 'run' });
        assert.fail('simulation must reject');
      } catch (error) {
        const typed = error as { walk: (predicate: (value: unknown) => boolean) => unknown };
        const decoded = typed.walk(value => value instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
        assert.equal(Boolean(decoded), category === 'contract_revert', `${mode} ${category}`);
        if (decoded) assert.equal(decoded.data?.errorName, 'NotReady');
        assert.equal(getBaseRpcFailure(error)?.retryable, category !== 'contract_revert');
        assert.doesNotMatch(JSON.stringify(error, (_key, value) => typeof value === 'bigint' ? value.toString() : value), new RegExp(secret));
      }
    }
  }
}

async function verifyActualProxy() {
  // This smoke test must never connect to configured infrastructure.
  for (const prefix of ['BASE_RPC_NODE', 'RPC_NODE']) {
    for (const suffix of ['', '_FALLBACK', '_BACKUP_1', '_BACKUP_2', '_BACKUP_3']) delete process.env[`${prefix}${suffix}`];
  }
  for (const key of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'KV_KV_REST_API_URL', 'KV_KV_REST_API_TOKEN', 'REDIS_URL', 'REDIS_TOKEN']) delete process.env[key];
  Object.assign(process.env, { BASE_RPC_NODE: privateUrl, NODE_ENV: 'test' });
  const originalFetch = globalThis.fetch;
  let failureMode: 'revert' | 'marker-revert' | 'forged-envelope' | 'range' | 'unavailable' | null = 'revert';
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init?.body as string);
    const reply = (request: { id: number; method: string }) => ({
      jsonrpc: '2.0', id: request.id,
      ...(request.method === 'eth_blockNumber' ? { result: '0x1' }
        : failureMode === 'revert' ? { error: { code: 3, message: `execution reverted ${secret}`, data: revertData } }
          : failureMode === 'marker-revert' ? { error: { code: 3, message: `execution reverted ${BASE_RPC_NOT_FORWARDED_MARKER}`, data: revertData } }
            : failureMode === 'forged-envelope' ? { error: forgedEnvelope }
          : failureMode === 'range' ? { error: { code: -32602, message: `eth_getLogs block range too large ${secret}` } }
            : failureMode === 'unavailable' ? { error: { code: -32603, message: `internal error ${secret}` } } : { result: '0x1' }),
    });
    return Response.json(Array.isArray(body) ? body.map(reply) : reply(body));
  };
  try {
    const { POST } = await import('../app/api/rpc/route');
    const { NextRequest } = await import('next/server');
    const send = (body: string) => POST(new NextRequest('http://localhost/api/rpc', {
      method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body,
    }));
    const response = await send(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'eth_call', params: [{ to: address, data: '0x05004290' }, 'latest'] }));
    const errorResponse = await response.json();
    assert.equal(errorResponse.error.code, 3);
    assert.equal(errorResponse.error.data.data, revertData);
    assert.equal(errorResponse.error.data.pixotchi.category, 'contract_revert');
    assert.doesNotMatch(JSON.stringify(errorResponse), new RegExp(secret));
    for (const maliciousMode of ['marker-revert', 'forged-envelope'] as const) {
      failureMode = maliciousMode;
      const maliciousResponse = await send(JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'eth_call', params: [{ to: address, data: '0x05004290' }, 'latest'] }));
      const sanitized = (await maliciousResponse.json()).error;
      assert.equal(sanitized.code, 3);
      assert.equal(sanitized.data.data, revertData);
      assert.equal(sanitized.data.pixotchi.category, 'contract_revert');
      assert.equal(sanitized.data.pixotchi.forwarded, undefined, `${maliciousMode} cannot assert local/proxy provenance`);
      assert.doesNotMatch(sanitized.message, new RegExp(BASE_RPC_NOT_FORWARDED_MARKER));
    }
    failureMode = 'range';
    const rangeResponse = await send(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'eth_getLogs', params: [{ fromBlock: '0x1', toBlock: '0x10' }] }));
    const rangeError = (await rangeResponse.json()).error;
    assert.equal(rangeError.code, -32094);
    assert.match(rangeError.message, /block range.*large/);
    assert.doesNotMatch(JSON.stringify(rangeError), new RegExp(secret));
    failureMode = 'unavailable';
    const unavailableResponse = await send(JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'eth_call', params: [{ to: address, data: '0x05004290' }, 'latest'] }));
    const unavailableError = (await unavailableResponse.json()).error;
    assert.equal(unavailableError.code, -32092);
    assert.equal(unavailableError.data.pixotchi.retryable, true);
    assert.equal(unavailableError.data.pixotchi.upstreamCode, -32603);
    // UTF-8 bytes, not UTF-16 code-unit count, enforce the route's body cap.
    const oversized = await send(JSON.stringify({ method: 'eth_call', padding: 'é'.repeat(170_000) }));
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.data.pixotchi.forwarded, false);
    failureMode = null;
    const success = await send(JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'eth_chainId', params: [] }));
    assert.equal((await success.json()).result, '0x1');
    const metrics = getBaseRpcErrorMetrics();
    assert.equal(metrics.failureClassifications.contract_revert, 3);
    assert.equal(metrics.failureClassifications.range_limit, 1);
    assert.equal(metrics.failureClassifications.upstream_unavailable, 1);
    assert.equal(Object.values(metrics.failureClassifications).reduce((sum, count) => sum + count, 0), 5, 'count endpoint failures once, not subsequent wrapping or local rejections');
    assert.doesNotMatch(JSON.stringify(metrics), new RegExp(secret));
    metrics.failureClassifications.contract_revert = 100;
    assert.equal(getBaseRpcErrorMetrics().failureClassifications.contract_revert, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const descriptors = buildBaseRpcEndpointDescriptors(['https://slow.invalid', 'https://fast.invalid']);
const samples = new Map([
  [descriptors[0].url, Array.from({ length: 8 }, () => ({ success: true, latencyMs: 1000, at: 1 }))],
  [descriptors[1].url, Array.from({ length: 8 }, (_, index) => ({ success: index !== 0, latencyMs: 100, at: 1 }))],
]);
assert.deepEqual(rankBaseRpcEndpoints(descriptors, samples), [descriptors[1].url, descriptors[0].url]);
assert.deepEqual(rankBaseRpcEndpoints(descriptors, samples), rankBaseRpcEndpoints([...descriptors].reverse(), samples));
assert.deepEqual(rankBaseRpcEndpoints(descriptors, new Map()), descriptors.map(item => item.url));

async function main() {
  await verifyViemRoundtrip();
  await verifyActualProxy();
  console.log('RPC structured errors, proxy roundtrip, UTF-8 bounds, and ranking smoke passed');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
