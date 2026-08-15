import { NextRequest, NextResponse } from 'next/server';
import { getBaseLogClient, getBaseReadClient, getBaseReceiptClient } from '@/lib/base-rpc';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Server-side JSON-RPC proxy for Base.
 *
 * The browser used to talk to the keyed provider endpoints directly, which meant
 * NEXT_PUBLIC_RPC_NODE* (and the Ankr/Alchemy/Coinbase API keys embedded in those
 * URLs) were inlined into the client bundle and readable by anyone. The keyed URLs
 * are now server-only (BASE_RPC_NODE*); the browser talks to this route instead and
 * the existing ranking / hedging / circuit-breaker failover happens here.
 *
 * This endpoint is same-origin-only (enforced in proxy.ts) and read-oriented: only
 * the methods the app actually needs are forwarded, so it can't be repurposed as a
 * free general-purpose archive node against our paid quota.
 */

/**
 * Method gating.
 *
 * This started as a strict allowlist and that was the wrong shape: live testing
 * caught `eth_fillTransaction` (which our upstream *does* support) being rejected
 * mid-transaction. Wallet stacks differ - Privy, Base Account and Coinbase each
 * probe slightly different methods - so an allowlist turns every method we failed
 * to predict into a broken user transaction.
 *
 * The actual goal is narrower: stop this proxy being used as a free archive/trace
 * node against our paid quota. So we deny the expensive and node-administrative
 * namespaces plus the stateful subscription/filter calls (which cannot work behind
 * multi-endpoint failover anyway), and forward the ordinary eth_/net_/web3_ surface.
 * Unknown-but-benign methods now behave exactly as they did before the proxy existed.
 */
const DENIED_METHOD_PREFIXES = [
  'admin_',
  'clique_',
  'debug_',
  'engine_',
  'les_',
  'miner_',
  'personal_',
  'trace_',
  'txpool_',
];

// Stateful on a single node: a filter or subscription created on one upstream
// endpoint is meaningless after failover routes the next call elsewhere.
const DENIED_METHODS = new Set([
  'eth_getFilterChanges',
  'eth_getFilterLogs',
  'eth_newBlockFilter',
  'eth_newFilter',
  'eth_newPendingTransactionFilter',
  'eth_subscribe',
  'eth_uninstallFilter',
  'eth_unsubscribe',
]);

const ALLOWED_METHOD_PREFIXES = ['eth_', 'net_', 'web3_'];

function isMethodAllowed(method: string): boolean {
  if (DENIED_METHODS.has(method)) return false;
  if (DENIED_METHOD_PREFIXES.some((prefix) => method.startsWith(prefix))) return false;
  return ALLOWED_METHOD_PREFIXES.some((prefix) => method.startsWith(prefix));
}

const RECEIPT_METHODS = new Set([
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
]);

const LOG_METHODS = new Set(['eth_getLogs']);

const MAX_BATCH_SIZE = 20;
const MAX_BODY_BYTES = 128 * 1024;
// eth_getLogs over a huge span is the one cheap-to-ask, expensive-to-serve call
// here, so bound the window rather than passing it straight through.
const MAX_LOG_BLOCK_RANGE = BigInt(10_000);

// JSON-RPC error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  id?: JsonRpcId;
  jsonrpc?: string;
  method?: unknown;
  params?: unknown;
};

// Approximate, per-instance throttle. Serverless instances are ephemeral so this
// is a DoS guard rather than a security boundary (the method allowlist and the
// same-origin check are the real controls); doing it in memory avoids adding a
// Redis round-trip to the latency of every single RPC call.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 1_500;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function getClientKey(request: NextRequest): string {
  return (
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function isRateLimited(key: string, cost: number): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: cost, resetAt: now + RATE_LIMIT_WINDOW_MS });

    // Opportunistic cleanup so the map can't grow without bound.
    if (rateLimitBuckets.size > 10_000) {
      for (const [bucketKey, value] of rateLimitBuckets) {
        if (value.resetAt <= now) rateLimitBuckets.delete(bucketKey);
      }
    }
    return false;
  }

  bucket.count += cost;
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { error: { code, message }, id: id ?? null, jsonrpc: '2.0' as const };
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return { id: id ?? null, jsonrpc: '2.0' as const, result };
}

function toBlockNumber(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  if (!/^0x[0-9a-fA-F]+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Reject unbounded eth_getLogs spans. Named-tag ranges ('latest', 'earliest', …)
 * and blockHash lookups are left alone; only explicit numeric spans are bounded.
 */
function isLogRangeTooWide(params: unknown): boolean {
  if (!Array.isArray(params) || params.length === 0) return false;
  const filter = params[0];
  if (!filter || typeof filter !== 'object') return false;

  const { fromBlock, toBlock } = filter as { fromBlock?: unknown; toBlock?: unknown };
  const from = toBlockNumber(fromBlock);
  const to = toBlockNumber(toBlock);
  if (from === null || to === null) return false;

  return to - from > MAX_LOG_BLOCK_RANGE;
}

function getClientForMethod(method: string) {
  if (RECEIPT_METHODS.has(method)) return getBaseReceiptClient();
  if (LOG_METHODS.has(method)) return getBaseLogClient();
  return getBaseReadClient();
}

async function handleSingle(payload: JsonRpcRequest) {
  const id = (payload?.id ?? null) as JsonRpcId;

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return rpcError(id, INVALID_REQUEST, 'Invalid JSON-RPC request');
  }

  const method = payload.method;
  if (typeof method !== 'string' || !method) {
    return rpcError(id, INVALID_REQUEST, 'Missing JSON-RPC method');
  }

  if (!isMethodAllowed(method)) {
    return rpcError(id, METHOD_NOT_FOUND, `Method ${method} is not supported`);
  }

  const params = payload.params === undefined ? [] : payload.params;
  if (!Array.isArray(params)) {
    return rpcError(id, INVALID_PARAMS, 'params must be an array');
  }

  if (method === 'eth_getLogs' && isLogRangeTooWide(params)) {
    return rpcError(
      id,
      INVALID_PARAMS,
      `eth_getLogs range is limited to ${MAX_LOG_BLOCK_RANGE} blocks`,
    );
  }

  try {
    const client = getClientForMethod(method);
    const result = await client.request({ method, params } as never);
    return rpcResult(id, result);
  } catch (error: unknown) {
    // Surface the upstream JSON-RPC error shape when there is one so viem can
    // classify it (reverts, nonce errors, …) instead of seeing a generic failure.
    const candidate = error as { code?: unknown; details?: unknown; message?: unknown; shortMessage?: unknown };
    const code = typeof candidate?.code === 'number' ? candidate.code : INTERNAL_ERROR;
    const message =
      (typeof candidate?.details === 'string' && candidate.details) ||
      (typeof candidate?.shortMessage === 'string' && candidate.shortMessage) ||
      (typeof candidate?.message === 'string' && candidate.message) ||
      'Base RPC request failed';

    return rpcError(id, code, message);
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json(rpcError(null, INVALID_REQUEST, 'Request body is too large'), {
      headers: { 'Cache-Control': 'private, no-store' },
      status: 413,
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(rpcError(null, PARSE_ERROR, 'Invalid JSON'), {
      headers: { 'Cache-Control': 'private, no-store' },
      status: 400,
    });
  }

  const isBatch = Array.isArray(payload);
  const requests = (isBatch ? payload : [payload]) as JsonRpcRequest[];

  if (isBatch && requests.length === 0) {
    return NextResponse.json(rpcError(null, INVALID_REQUEST, 'Empty batch'), {
      headers: { 'Cache-Control': 'private, no-store' },
      status: 400,
    });
  }

  if (requests.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      rpcError(null, INVALID_REQUEST, `Batch size is limited to ${MAX_BATCH_SIZE}`),
      { headers: { 'Cache-Control': 'private, no-store' }, status: 400 },
    );
  }

  if (isRateLimited(getClientKey(request), requests.length)) {
    return NextResponse.json(rpcError(null, INTERNAL_ERROR, 'Rate limit exceeded'), {
      headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '60' },
      status: 429,
    });
  }

  const responses = await Promise.all(requests.map(handleSingle));

  return NextResponse.json(isBatch ? responses : responses[0], {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
