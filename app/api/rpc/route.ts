import { NextRequest, NextResponse } from 'next/server';
import { getBaseLogClient, getBaseReadClient, getBaseReceiptClient } from '@/lib/base-rpc';
import { BASE_RPC_MAX_BATCH_SIZE, BASE_RPC_MAX_BODY_BYTES } from '@/lib/base-rpc-policy';

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

/** Public-client methods exercised by the game and by Viem's receipt waiter. */
const ALLOWED_READ_METHODS = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockByHash',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_getStorageAt',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas',
  'net_version',
  'web3_clientVersion',
]);

const DEVELOPMENT_WRITE_METHODS = new Set([
  'eth_fillTransaction',
  'eth_sendRawTransaction',
]);

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function allowsDevelopmentWrites(request: NextRequest): boolean {
  return process.env.NODE_ENV !== 'production'
    && isLoopbackHostname(request.nextUrl.hostname)
    // The configured localhost-only wallet is the explicit feature flag. A
    // deployment without it cannot accidentally expose raw submission.
    && /^0x[0-9a-f]{64}$/i.test(process.env.NEXT_PUBLIC_LOCAL_TEST_WALLET_PRIVATE_KEY ?? '');
}

function isMethodAllowed(method: string, allowDevelopmentWrites: boolean): boolean {
  return ALLOWED_READ_METHODS.has(method)
    || (allowDevelopmentWrites && DEVELOPMENT_WRITE_METHODS.has(method));
}

const RECEIPT_METHODS = new Set([
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
]);

const LOG_METHODS = new Set(['eth_getLogs']);

// Shared with the browser-side batcher in lib/base-rpc.ts so the two cannot
// drift: a client batch larger than this is rejected whole, taking every call
// inside it down with no chance of per-call failover.
const MAX_BATCH_SIZE = BASE_RPC_MAX_BATCH_SIZE;
// Derived from the browser batcher's own worst case, not chosen independently:
// a cap below what our client can legitimately emit rejects the whole batch.
const MAX_BODY_BYTES = BASE_RPC_MAX_BODY_BYTES;
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

function rpcError(id: JsonRpcId, code: number, message: string, data?: string) {
  return {
    error: { code, message, ...(data ? { data } : {}) },
    id: id ?? null,
    jsonrpc: '2.0' as const,
  };
}

/**
 * Rejections this proxy makes on its own, before anything is forwarded upstream.
 *
 * These matter beyond diagnostics. The client cannot normally tell a
 * "your request was refused here" failure from a "we forwarded it and lost the
 * response" one, so it has to assume the worst: an `eth_sendRawTransaction`
 * that fails ambiguously leaves a durable reservation that locks the wallet
 * until the player confirms nothing was sent. When *we* refuse the call, we know
 * for a fact it never reached a node, so we say so and the client can release
 * that lock immediately instead of stranding the player.
 *
 * The marker travels in the message because a non-2xx response reaches viem as
 * an opaque HttpRequestError whose body is only ever surfaced as text.
 */
const NOT_FORWARDED_MARKER = 'PIXOTCHI_PROXY_NOT_FORWARDED';

function notForwardedError(id: JsonRpcId, code: number, message: string) {
  return rpcError(id, code, `${message} [${NOT_FORWARDED_MARKER}]`);
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

function validateSingle(payload: JsonRpcRequest, allowDevelopmentWrites: boolean) {
  const id = (payload?.id ?? null) as JsonRpcId;

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return notForwardedError(id, INVALID_REQUEST, 'Invalid JSON-RPC request');
  }

  const method = payload.method;
  if (typeof method !== 'string' || !method) {
    return notForwardedError(id, INVALID_REQUEST, 'Missing JSON-RPC method');
  }

  if (!isMethodAllowed(method, allowDevelopmentWrites)) {
    return notForwardedError(id, METHOD_NOT_FOUND, `Method ${method} is not supported`);
  }

  const params = payload.params === undefined ? [] : payload.params;
  if (!Array.isArray(params)) {
    return notForwardedError(id, INVALID_PARAMS, 'params must be an array');
  }

  if (method === 'eth_getLogs' && isLogRangeTooWide(params)) {
    return notForwardedError(
      id,
      INVALID_PARAMS,
      `eth_getLogs range is limited to ${MAX_LOG_BLOCK_RANGE} blocks`,
    );
  }

  return null;
}

function getSafeRpcError(error: unknown): { code: number; data?: string } {
  const visited = new Set<unknown>();
  let current: unknown = error;
  let code: number | undefined;
  let data: string | undefined;

  for (let depth = 0; depth < 8 && current && !visited.has(current); depth += 1) {
    visited.add(current);
    if (typeof current !== 'object') break;
    const candidate = current as { cause?: unknown; code?: unknown; data?: unknown };
    if (code === undefined && typeof candidate.code === 'number') code = candidate.code;
    if (
      data === undefined
      && typeof candidate.data === 'string'
      && /^0x[0-9a-f]*$/i.test(candidate.data)
      && candidate.data.length <= MAX_BODY_BYTES
    ) {
      data = candidate.data;
    }
    current = candidate.cause;
  }

  return { code: code ?? INTERNAL_ERROR, ...(data ? { data } : {}) };
}

function safeRpcMessage(code: number): string {
  if (code === -32700) return 'Upstream RPC could not parse the request';
  if (code === -32600) return 'Upstream RPC rejected the request';
  if (code === -32601) return 'Upstream RPC method is unavailable';
  if (code === -32602) return 'Upstream RPC rejected the parameters';
  if (code === 3) return 'Contract execution reverted';
  return 'Base RPC request failed';
}

async function handleSingle(payload: JsonRpcRequest) {
  const id = (payload?.id ?? null) as JsonRpcId;
  const method = payload.method as string;
  const params = payload.params === undefined ? [] : payload.params as unknown[];

  try {
    const client = getClientForMethod(method);
    const result = await client.request({ method, params } as never);
    return rpcResult(id, result);
  } catch (error: unknown) {
    const safe = getSafeRpcError(error);
    return rpcError(id, safe.code, safeRpcMessage(safe.code), safe.data);
  }
}

function parseAllowedOrigins(request: NextRequest): Set<string> {
  const configured = [
    process.env.NEXT_PUBLIC_URL,
    ...(process.env.ALLOWED_PUBLIC_API_ORIGINS ?? '').split(','),
  ];
  const origins = new Set<string>([request.nextUrl.origin]);
  for (const value of configured) {
    const candidate = value?.trim().replace(/^['"]|['"]$/g, '');
    if (!candidate) continue;
    try {
      origins.add(new URL(candidate).origin);
    } catch {
      // Invalid deployment configuration must not broaden the boundary.
    }
  }
  return origins;
}

function hasAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  if (parseAllowedOrigins(request).has(origin)) return true;

  if (process.env.NODE_ENV !== 'production') {
    try {
      const candidate = new URL(origin);
      return isLoopbackHostname(candidate.hostname)
        && isLoopbackHostname(request.nextUrl.hostname)
        && candidate.protocol === request.nextUrl.protocol
        && candidate.port === request.nextUrl.port;
    } catch {
      return false;
    }
  }

  return false;
}

export async function POST(request: NextRequest) {
  if (!hasAllowedOrigin(request)) {
    return NextResponse.json(notForwardedError(null, INVALID_REQUEST, 'Origin is not allowed'), {
      headers: { 'Cache-Control': 'private, no-store' },
      status: 403,
    });
  }

  const rawBody = await request.text();

  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json(notForwardedError(null, INVALID_REQUEST, 'Request body is too large'), {
      headers: { 'Cache-Control': 'private, no-store' },
      status: 413,
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(notForwardedError(null, PARSE_ERROR, 'Invalid JSON'), {
      headers: { 'Cache-Control': 'private, no-store' },
      status: 400,
    });
  }

  const isBatch = Array.isArray(payload);
  const requests = (isBatch ? payload : [payload]) as JsonRpcRequest[];

  if (isBatch && requests.length === 0) {
    return NextResponse.json(notForwardedError(null, INVALID_REQUEST, 'Empty batch'), {
      headers: { 'Cache-Control': 'private, no-store' },
      status: 400,
    });
  }

  if (requests.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      notForwardedError(null, INVALID_REQUEST, `Batch size is limited to ${MAX_BATCH_SIZE}`),
      { headers: { 'Cache-Control': 'private, no-store' }, status: 400 },
    );
  }

  const allowDevelopmentWrites = allowsDevelopmentWrites(request);
  const validationErrors = requests.map((entry) => validateSingle(entry, allowDevelopmentWrites));
  if (validationErrors.some(Boolean)) {
    const rejected = validationErrors.map((error, index) => (
      error ?? notForwardedError(
        (requests[index]?.id ?? null) as JsonRpcId,
        INVALID_REQUEST,
        'JSON-RPC batch rejected because another request was invalid',
      )
    ));
    return NextResponse.json(isBatch ? rejected : rejected[0], {
      headers: { 'Cache-Control': 'private, no-store' },
      status: 400,
    });
  }

  if (isRateLimited(getClientKey(request), requests.length)) {
    return NextResponse.json(notForwardedError(null, INTERNAL_ERROR, 'Rate limit exceeded'), {
      headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '60' },
      status: 429,
    });
  }

  const responses = await Promise.all(requests.map(handleSingle));

  return NextResponse.json(isBatch ? responses : responses[0], {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
