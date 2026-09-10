import assert from 'node:assert/strict';
import {
  createPublicClient,
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  http,
  multicall3Abi,
} from 'viem';
import { base } from 'viem/chains';
import { BaseRpcError, getBaseRpcFailure } from '../lib/base-rpc-errors';
import { createBoundedBaseRpcFetch, getBaseRpcFetchMetrics } from '../lib/base-rpc-fetch';
import {
  BASE_RPC_MAX_BODY_BYTES,
  BASE_RPC_BROWSER_MULTICALL_INNER_BYTES,
} from '../lib/base-rpc-policy';

type RequestRow = { jsonrpc: '2.0'; id: number | string; method: string; params: unknown[] };
type ResponseRow = { jsonrpc: '2.0'; id: number | string; result?: unknown; error?: unknown };
const url = 'https://rpc.invalid/api/rpc';
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const request = (id: number | string, params: unknown[] = []): RequestRow => ({ jsonrpc: '2.0', id, method: 'eth_call', params });
const rows = (init?: RequestInit): RequestRow[] => {
  const body = JSON.parse(String(init?.body));
  return Array.isArray(body) ? body : [body];
};
const successful = (row: RequestRow): ResponseRow => ({ jsonrpc: '2.0', id: row.id, result: `result-${row.id}` });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const init = (requests: RequestRow | RequestRow[], signal?: AbortSignal): RequestInit => ({ method: 'POST', body: JSON.stringify(requests), signal });
const expectCategory = (error: unknown, category: string) => assert.equal(getBaseRpcFailure(error)?.category, category);
let checks = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  checks += 1;
  console.log(`PASS ${name}`);
}

async function main() {
  await check('single request and Request input preserve method, credentials, headers, and signal', async () => {
    const controller = new AbortController();
    const bodies: unknown[] = [];
    const bounded = createBoundedBaseRpcFetch({ fetchFn: async (_input, options) => {
      assert.equal(options?.method, 'POST');
      assert.equal(options?.credentials, 'same-origin');
      assert.equal(options?.signal, controller.signal);
      assert.equal(new Headers(options.headers).get('X-Smoke'), 'present');
      assert.equal(new Headers(options.headers).has('Content-Length'), false);
      bodies.push(JSON.parse(String(options.body)));
      return response(successful(rows(options)[0]));
    } });
    const row = request(1, [{ data: '0x12345678' }]);
    const result = await bounded(url, { ...init(row, controller.signal), credentials: 'same-origin', headers: { 'X-Smoke': 'present', 'Content-Length': '1' } });
    assert.deepEqual(await result.json(), successful(row));
    assert.deepEqual(bodies, [row]);

    const native = new Request(url, { ...init(row), headers: { 'X-Smoke': 'request' } });
    const nativeFetch = createBoundedBaseRpcFetch({ fetchFn: async (_input, options) => {
      assert.equal(options?.signal, native.signal);
      assert.equal(new Headers(options?.headers).get('X-Smoke'), 'request');
      return response(successful(rows(options)[0]));
    } });
    assert.deepEqual(await (await nativeFetch(native)).json(), successful(row));
  });

  await check('actual UTF-8 bytes obey exact and one-byte-over array boundaries', async () => {
    const requests = [request(1, ['🪴é']), request(2, ['🪴é'])];
    const exactBytes = bytes(JSON.stringify(requests));
    assert.ok(exactBytes > JSON.stringify(requests).length);
    for (const [maximum, expectedCount] of [[exactBytes, 1], [exactBytes - 1, 2]]) {
      const sent: RequestRow[][] = [];
      const bounded = createBoundedBaseRpcFetch({ maxBodyBytes: maximum, fetchFn: async (_input, options) => {
        assert.ok(bytes(String(options?.body)) <= maximum);
        sent.push(rows(options));
        return response(rows(options).map(successful).reverse());
      } });
      assert.deepEqual(await (await bounded(url, init(requests))).json(), requests.map(successful));
      assert.equal(sent.length, expectedCount);
      assert.deepEqual(sent.flat(), requests);
    }
  });

  await check('normal batching retains up to twenty RPC entries per physical request', async () => {
    const requests = Array.from({ length: 41 }, (_, index) => request(index));
    const sizes: number[] = [];
    const bounded = createBoundedBaseRpcFetch({ fetchFn: async (_input, options) => {
      sizes.push(rows(options).length);
      return response(rows(options).map(successful).reverse());
    } });
    assert.deepEqual(await (await bounded(url, init(requests))).json(), requests.map(successful));
    assert.deepEqual(sizes, [20, 20, 1]);
  });

  await check('oversized later singleton rejects the entire batch before any dispatch', async () => {
    let sent = 0;
    const before = getBaseRpcFetchMetrics();
    const bounded = createBoundedBaseRpcFetch({ maxBodyBytes: 300, fetchFn: async () => {
      sent += 1;
      return response({});
    } });
    await assert.rejects(bounded(url, init([request(1), request(2), request(3, [{ data: `0x${'00'.repeat(1000)}` }])])), (error: unknown) => {
      assert.ok(error instanceof BaseRpcError);
      expectCategory(error, 'request_too_large');
      assert.equal(getBaseRpcFailure(error)?.forwarded, false);
      return true;
    });
    assert.equal(sent, 0);
    assert.equal(getBaseRpcFetchMetrics().rejectedOversize - before.rejectedOversize, 1);
  });

  await check('concurrency is capped at four while every chunk shares the caller signal', async () => {
    const controller = new AbortController();
    let active = 0;
    let peak = 0;
    let count = 0;
    const bounded = createBoundedBaseRpcFetch({ maxBatchSize: 1, maxConcurrency: 100, fetchFn: async (_input, options) => {
      assert.equal(options?.signal, controller.signal);
      active += 1;
      count += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active -= 1;
      return response(rows(options).map(successful));
    } });
    const requests = Array.from({ length: 12 }, (_, index) => request(index));
    assert.deepEqual(await (await bounded(url, init(requests, controller.signal))).json(), requests.map(successful));
    assert.equal(peak, 4);
    assert.equal(count, 12);
  });

  await check('failed chunks preserve successful siblings and do not retain network diagnostics', async () => {
    const bounded = createBoundedBaseRpcFetch({ maxBatchSize: 1, fetchFn: async (_input, options) => {
      const chunk = rows(options);
      if (chunk[0].id === 2) throw new TypeError('fetch failed https://private.invalid/API-KEY-SENTINEL');
      return response(chunk.map(successful));
    } });
    const requests = [request(1), request(2), request(3)];
    const result: ResponseRow[] = await (await bounded(url, init(requests))).json();
    assert.deepEqual(result[0], successful(requests[0]));
    assert.deepEqual(result[2], successful(requests[2]));
    expectCategory(result[1].error, 'network');
    assert.equal(JSON.stringify(result).includes('API-KEY-SENTINEL'), false);
  });

  await check('missing, duplicate, unknown, ambiguous, and malformed response IDs affect only their chunk', async () => {
    const requests = [request(1), request(2), request(3), request(4)];
    const badValues = [
      [successful(requests[0])],
      [successful(requests[0]), successful(requests[0])],
      [successful(requests[0]), successful(request(100))],
      [{ ...successful(requests[0]), error: { code: -32603, message: 'bad' } }, successful(requests[1])],
      [{ jsonrpc: '2.0', id: null, result: 'bad' }],
      [{ jsonrpc: '2.0', id: 1, error: { code: 'bad', message: 'bad' } }, successful(requests[1])],
      { id: null, error: { code: -32005, message: 'rate limited' } },
    ];
    for (const bad of badValues) {
      const bounded = createBoundedBaseRpcFetch({ maxBatchSize: 2, fetchFn: async (_input, options) => {
        const chunk = rows(options);
        return response(chunk[0].id === 1 ? bad : chunk.map(successful).reverse());
      } });
      const result: ResponseRow[] = await (await bounded(url, init(requests))).json();
      result.slice(0, 2).forEach(row => expectCategory(row.error, 'malformed_response'));
      assert.deepEqual(result.slice(2), requests.slice(2).map(successful));
    }
  });

  await check('batch-wide null-ID proxy errors map to every ID within the affected chunk', async () => {
    const requests = [request(1), request(2), request(3)];
    const bounded = createBoundedBaseRpcFetch({ maxBatchSize: 2, fetchFn: async (_input, options) => {
      const chunk = rows(options);
      return chunk[0].id === 1
        ? response({ jsonrpc: '2.0', id: null, error: { code: -32005, message: 'Too many requests' } }, 429)
        : response(chunk.map(successful));
    } });
    const result: ResponseRow[] = await (await bounded(url, init(requests))).json();
    assert.deepEqual(result.map(row => row.id), [1, 2, 3]);
    result.slice(0, 2).forEach(row => expectCategory(row.error, 'rate_limited'));
    assert.deepEqual(result[2], successful(requests[2]));
  });

  await check('non-JSON HTTP failure categories use status codes while malformed HTTP 200 stays malformed', async () => {
    for (const [status, category] of [[429, 'rate_limited'], [503, 'upstream_unavailable'], [413, 'request_too_large'], [401, 'authorization'], [200, 'malformed_response']] as const) {
      const bounded = createBoundedBaseRpcFetch({ fetchFn: async () => new Response('private URL SENTINEL', { status }) });
      const result: ResponseRow = await (await bounded(url, init(request(1)))).json();
      expectCategory(result.error, category);
      assert.equal(JSON.stringify(result).includes('SENTINEL'), false);
    }
  });

  await check('rate-limit Retry-After headers are bounded and survive JSON and non-JSON responses', async () => {
    for (const [header, expected] of [['2.5', 2500], ['900', 300000], ['bad', undefined]] as const) {
      for (const json of [true, false]) {
        const bounded = createBoundedBaseRpcFetch({ fetchFn: async () => new Response(json
          ? JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32005, message: 'rate limited' } })
          : 'busy', { status: 429, headers: { 'Retry-After': header } }) });
        const result: ResponseRow = await (await bounded(url, init(request(1)))).json();
        expectCategory(result.error, 'rate_limited');
        assert.equal(getBaseRpcFailure(result.error)?.retryAfterMs, expected);
      }
    }
  });

  await check('string and numeric IDs are distinct and duplicate request IDs fail before network', async () => {
    let count = 0;
    const bounded = createBoundedBaseRpcFetch({ fetchFn: async (_input, options) => {
      count += 1;
      return response(rows(options).map(row => ({ ...successful(row), result: typeof row.id })).reverse());
    } });
    const result: ResponseRow[] = await (await bounded(url, init([request(1), request('1')]))).json();
    assert.deepEqual(result.map(row => row.result), ['number', 'string']);
    await assert.rejects(bounded(url, init([request(1), request(1)])), (error: unknown) => {
      expectCategory(error, 'invalid_request');
      return true;
    });
    assert.equal(count, 1);
  });

  await check('already-aborted requests dispatch nothing and in-flight abort stops queued chunks', async () => {
    const controller = new AbortController();
    let sent = 0;
    const bounded = createBoundedBaseRpcFetch({ maxBatchSize: 1, fetchFn: async () => {
      sent += 1;
      return new Promise<Response>(() => {});
    } });
    const requests = Array.from({ length: 10 }, (_, index) => request(index));
    const pending = bounded(url, init(requests, controller.signal));
    assert.equal(sent, 4);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(sent, 4);
    await assert.rejects(bounded(url, init(requests, controller.signal)), { name: 'AbortError' });
    assert.equal(sent, 4);
  });

  await check('abort also cancels a pending response stream without leaking a reader', async () => {
    const controller = new AbortController();
    let canceled = false;
    let startRead: (() => void) | undefined;
    const reading = new Promise<void>(resolve => { startRead = resolve; });
    const bounded = createBoundedBaseRpcFetch({ fetchFn: async () => new Response(new ReadableStream<Uint8Array>({
      pull() { startRead?.(); },
      cancel() { canceled = true; },
    })) });
    const pending = bounded(url, init(request(1), controller.signal));
    await reading;
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    await Promise.resolve();
    assert.equal(canceled, true);
  });

  await check('streaming and combined response budgets preserve completed chunks and cancel oversized streams', async () => {
    const requests = [request(1), request(2), request(3)];
    let dispatched = 0;
    let canceled = false;
    const bounded = createBoundedBaseRpcFetch({ maxBatchSize: 1, maxConcurrency: 1, maxResponseBytes: 1500, fetchFn: async (_input, options) => {
      dispatched += 1;
      const row = rows(options)[0];
      if (row.id === 1) return response([{ ...successful(row), result: 'a'.repeat(600) }]);
      return new Response(new ReadableStream<Uint8Array>({
        start(stream) { stream.enqueue(new TextEncoder().encode('b'.repeat(1000))); },
        cancel() { canceled = true; },
      }));
    } });
    const text = await (await bounded(url, init(requests))).text();
    assert.ok(bytes(text) <= 1500);
    const result: ResponseRow[] = JSON.parse(text);
    assert.equal(result[0].result, 'a'.repeat(600));
    result.slice(1).forEach(row => expectCategory(row.error, 'malformed_response'));
    assert.equal(dispatched, 2);
    assert.equal(canceled, true);
  });

  await check('declared oversized response is canceled and scoped to the affected chunk', async () => {
    let canceled = false;
    const bounded = createBoundedBaseRpcFetch({ maxBatchSize: 1, maxConcurrency: 1, maxResponseBytes: 1000, fetchFn: async (_input, options) => {
      if (rows(options)[0].id === 2) return response(rows(options).map(successful));
      return new Response(new ReadableStream<Uint8Array>({ cancel() { canceled = true; } }), { headers: { 'Content-Length': '1001' } });
    } });
    const result: ResponseRow[] = await (await bounded(url, init([request(1), request(2)]))).json();
    expectCategory(result[0].error, 'malformed_response');
    assert.deepEqual(result[1], successful(request(2)));
    assert.equal(canceled, true);
  });

  await check('combined output accounts for error-envelope expansion and preserves smaller successful chunks', async () => {
    const first = successful(request(1));
    const second = { jsonrpc: '2.0', id: 2, error: { code: 3, message: '', data: `0x${'ab'.repeat(300)}` } };
    // Raw response bodies fit, but normalizing the second error adds the safe
    // classification envelope and must not exceed the combined output budget.
    const maximum = bytes(JSON.stringify([first])) + bytes(JSON.stringify([second])) + 1;
    const bounded = createBoundedBaseRpcFetch({ maxBatchSize: 1, maxConcurrency: 1, maxResponseBytes: maximum, fetchFn: async (_input, options) =>
      response(rows(options)[0].id === 1 ? [first] : [second]),
    });
    const text = await (await bounded(url, init([request(1), request(2)]))).text();
    assert.ok(bytes(text) <= maximum);
    const result: ResponseRow[] = JSON.parse(text);
    assert.deepEqual(result[0], first);
    expectCategory(result[1].error, 'malformed_response');
  });

  await check('actual Viem multicall serialization stays below proxy limits without changing aggregate calldata', async () => {
    const serialized: string[] = [];
    let aggregateCalls = 0;
    const bounded = createBoundedBaseRpcFetch({ fetchFn: async (_input, options) => {
      const body = String(options?.body);
      serialized.push(body);
      assert.ok(bytes(body) <= BASE_RPC_MAX_BODY_BYTES);
      assert.ok(rows(options).length <= 20);
      return response(rows(options).map(row => {
        const params = row.params as [{ data: `0x${string}` }];
        const decoded = decodeFunctionData({ abi: multicall3Abi, data: params[0].data });
        assert.equal(decoded.functionName, 'aggregate3');
        const calls = decoded.args[0];
        aggregateCalls += calls.length;
        calls.forEach(call => assert.equal(call.callData, '0x18160ddd'));
        return { jsonrpc: '2.0', id: row.id, result: encodeFunctionResult({
          abi: multicall3Abi,
          functionName: 'aggregate3',
          result: calls.map(() => ({ success: true, returnData: encodeFunctionResult({ abi: erc20Abi, functionName: 'totalSupply', result: BigInt(42) }) })),
        }) };
      }));
    } });
    const client = createPublicClient({
      chain: base,
      batch: { multicall: { batchSize: BASE_RPC_BROWSER_MULTICALL_INNER_BYTES } },
      transport: http(url, { batch: { batchSize: 20 }, fetchFn: bounded, retryCount: 0 }),
    });
    const result = await client.multicall({ allowFailure: false, contracts: Array.from({ length: 1000 }, () => ({
      address: '0x0000000000000000000000000000000000000001' as const,
      abi: erc20Abi,
      functionName: 'totalSupply' as const,
    })) });
    assert.equal(aggregateCalls, 1000);
    assert.deepEqual(result, Array.from({ length: 1000 }, () => BigInt(42)));
    assert.equal(serialized.length, 2);
  });

  await check('actual Viem HTTP batching routes partial failures and structured errors to the correct calls', async () => {
    let physical = 0;
    const bounded = createBoundedBaseRpcFetch({ maxBatchSize: 1, fetchFn: async (_input, options) => {
      physical += 1;
      const row = rows(options)[0];
      return row.method === 'eth_blockNumber'
        ? response([{ jsonrpc: '2.0', id: row.id, result: '0x2a' }])
        : response({ jsonrpc: '2.0', id: null, error: { code: -32005, message: 'rate limited' } }, 429);
    } });
    const client = createPublicClient({ chain: base, transport: http(`${url}/viem-partial`, { batch: true, fetchFn: bounded, retryCount: 0 }) });
    const result = await Promise.allSettled([client.getBlockNumber(), client.getChainId()]);
    assert.deepEqual(result[0], { status: 'fulfilled', value: BigInt(42) });
    assert.equal(result[1].status, 'rejected');
    if (result[1].status === 'rejected') expectCategory(result[1].reason, 'rate_limited');
    assert.equal(physical, 2);
  });

  await check('actual Viem wrappers retain oversized-request classification and the not-forwarded fact', async () => {
    let physical = 0;
    const bounded = createBoundedBaseRpcFetch({ maxBodyBytes: 80, fetchFn: async () => {
      physical += 1;
      return response({});
    } });
    const client = createPublicClient({ chain: base, transport: http(`${url}/viem-preflight`, { batch: true, fetchFn: bounded, retryCount: 0 }) });
    await assert.rejects(client.getBalance({ address: '0x0000000000000000000000000000000000000001' }), (error: unknown) => {
      expectCategory(error, 'request_too_large');
      assert.equal(getBaseRpcFailure(error)?.forwarded, false);
      return true;
    });
    assert.equal(physical, 0);
  });

  await check('body-byte telemetry matches physical UTF-8 requests and excludes preflight rejections', async () => {
    const before = getBaseRpcFetchMetrics();
    const sentBytes: number[] = [];
    const bounded = createBoundedBaseRpcFetch({ maxBatchSize: 1, maxBodyBytes: 300, fetchFn: async (_input, options) => {
      sentBytes.push(bytes(String(options?.body)));
      if (rows(options)[0].id === 2) throw new TypeError('fetch failed');
      return response(rows(options).map(successful));
    } });
    const requests = [request(1, ['🪴é']), request(2, ['longer payload'])];
    await bounded(url, init(requests));
    await assert.rejects(bounded(url, init(request(3, ['x'.repeat(300)]))));
    const after = getBaseRpcFetchMetrics();
    assert.equal(after.physicalRequests - before.physicalRequests, 2);
    assert.equal(after.totalRequestBodyBytes - before.totalRequestBodyBytes, sentBytes.reduce((total, size) => total + size, 0));
    assert.equal(after.maxRequestBodyBytes, Math.max(before.maxRequestBodyBytes, ...sentBytes));
    assert.equal(after.rejectedOversize - before.rejectedOversize, 1);
    assert.deepEqual(sentBytes, requests.map(row => bytes(JSON.stringify([row]))));
    // Callers receive a snapshot and cannot change the accumulating telemetry.
    after.totalRequestBodyBytes = 0;
    assert.ok(getBaseRpcFetchMetrics().totalRequestBodyBytes > 0);
    for (const value of Object.values(getBaseRpcFetchMetrics())) {
      assert.ok(Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER);
    }
  });

  const metrics = getBaseRpcFetchMetrics();
  assert.ok(metrics.physicalRequests > 0 && metrics.splitBatches > 0 && metrics.responseFailures > 0);
  assert.deepEqual(Object.keys(metrics).sort(), ['maxRequestBodyBytes', 'physicalRequests', 'rejectedOversize', 'responseFailures', 'splitBatches', 'totalRequestBodyBytes']);
  console.log(`RPC batching smoke passed (${checks} behavioral checks, all network responses mocked).`);
}

main().catch(error => {
  // Viem includes complete aggregate calldata in formatted errors; keep failing
  // smoke output bounded, too.
  console.error(error instanceof Error ? `${error.name}: ${error.message.slice(0, 1000)}` : 'RPC batching smoke failed');
  process.exitCode = 1;
});
