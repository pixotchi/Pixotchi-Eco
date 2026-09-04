import { NextRequest, NextResponse } from 'next/server';
import { getBaseLogClient, getBaseReadClient, getBaseReceiptClient } from '@/lib/base-rpc';
import { BASE_RPC_MAX_BATCH_SIZE, BASE_RPC_MAX_BODY_BYTES } from '@/lib/base-rpc-policy';
import { ChatAuthError, getChatSessionOrQuickAuthFromRequest } from '@/lib/chat-auth';
import { redisExpire, redisIncrBy } from '@/lib/redis';

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
 *
 * `Origin` protects browser callers from cross-site use, but it is a caller-supplied
 * header for non-browser HTTP clients. It is therefore never treated as a credential
 * here. Requests with an app session (or a verified Farcaster Quick Auth identity)
 * receive an address-bound rate-limit tier. The small anonymous tier below exists
 * solely for the chain reads a wallet must make before it can authenticate; it has a
 * shared global limiter so spoofed Origin/IP headers cannot turn it into an unlimited
 * provider-key relay.
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
]);

/**
 * Wallet connection and first-login flows need these read-only calls before a
 * session exists. Storage access deliberately requires an authenticated
 * identity; bounded log queries remain available but carry a much higher cost.
 * Keep this list narrower than ALLOWED_READ_METHODS.
 */
const ANONYMOUS_READ_METHODS = new Set([
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
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_maxPriorityFeePerGas',
  'net_version',
]);

export function isAnonymousBaseRpcMethodAllowed(method: string): boolean {
  return ANONYMOUS_READ_METHODS.has(method);
}

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

// Redis is the production security boundary: serverless-instance Maps are not
// shared and can be bypassed by spreading requests across instances. Development
// retains a small process-local fallback so a local app without Upstash stays
// usable; production returns 503 instead of exposing a paid provider key when
// durable accounting is unavailable.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_WINDOW_SECONDS = RATE_LIMIT_WINDOW_MS / 1_000;
const ANONYMOUS_GLOBAL_RATE_LIMIT = 1_200;
const ANONYMOUS_IP_RATE_LIMIT = 240;
const AUTHENTICATED_ADDRESS_RATE_LIMIT = 1_500;
const AUTHENTICATED_IP_RATE_LIMIT = 2_000;
const developmentRateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

type RpcAccessTier =
  | { kind: 'anonymous' }
  | { address: string; kind: 'authenticated' };

type RpcRateLimitResult =
  | { status: 'allowed' }
  | { status: 'limited' }
  | { status: 'unavailable' };

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function getClientKey(request: NextRequest): string {
  const candidate = (
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );

  // Do not let an arbitrary header become an unbounded Redis key. The global
  // anonymous bucket remains the protection if an upstream has not normalized
  // these forwarded-IP headers for us.
  return /^[0-9a-f:.]{3,64}$/i.test(candidate) ? candidate.toLowerCase() : 'unknown';
}

function isDevelopmentRateLimited(key: string, cost: number, limit: number): boolean {
  const now = Date.now();
  const bucket = developmentRateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    developmentRateLimitBuckets.set(key, { count: cost, resetAt: now + RATE_LIMIT_WINDOW_MS });

    // Opportunistic cleanup so the map can't grow without bound.
    if (developmentRateLimitBuckets.size > 10_000) {
      for (const [bucketKey, value] of developmentRateLimitBuckets) {
        if (value.resetAt <= now) developmentRateLimitBuckets.delete(bucketKey);
      }
    }
    return cost > limit;
  }

  bucket.count += cost;
  return bucket.count > limit;
}

async function incrementRpcRateLimit(
  key: string,
  cost: number,
  limit: number,
): Promise<RpcRateLimitResult> {
  const hits = await redisIncrBy(key, cost);
  if (hits === null) {
    if (isProduction()) return { status: 'unavailable' };
    return isDevelopmentRateLimited(key, cost, limit)
      ? { status: 'limited' }
      : { status: 'allowed' };
  }

  // The first increment must attach a TTL. The window is also encoded into the
  // key, but a missing expiry would leak keys and leave the limiter's retention
  // state unknown; fail closed instead of silently accepting that condition.
  if (hits === cost && !(await redisExpire(key, RATE_LIMIT_WINDOW_SECONDS + 5))) {
    return { status: 'unavailable' };
  }

  return hits > limit ? { status: 'limited' } : { status: 'allowed' };
}

async function enforceRpcRateLimit(
  request: NextRequest,
  access: RpcAccessTier,
  cost: number,
): Promise<RpcRateLimitResult> {
  const currentWindow = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
  const clientKey = getClientKey(request);
  const rules = access.kind === 'authenticated'
    ? [
      {
        key: `rpc:rate:authenticated:address:${access.address}:${currentWindow}`,
        limit: AUTHENTICATED_ADDRESS_RATE_LIMIT,
      },
      {
        key: `rpc:rate:authenticated:ip:${clientKey}:${currentWindow}`,
        limit: AUTHENTICATED_IP_RATE_LIMIT,
      },
    ]
    : [
      // This is intentionally shared rather than keyed by Origin/IP. An
      // unauthenticated script can forge both headers, but cannot bypass this
      // bucket without a session-bearing or Quick-Auth request.
      {
        key: `rpc:rate:anonymous:global:${currentWindow}`,
        limit: ANONYMOUS_GLOBAL_RATE_LIMIT,
      },
      {
        key: `rpc:rate:anonymous:ip:${clientKey}:${currentWindow}`,
        limit: ANONYMOUS_IP_RATE_LIMIT,
      },
    ];

  for (const rule of rules) {
    const result = await incrementRpcRateLimit(rule.key, cost, rule.limit);
    if (result.status !== 'allowed') return result;
  }

  return { status: 'allowed' };
}

/** Weight costly provider operations more heavily than ordinary wallet reads. */
export function getBaseRpcRequestCost(method: string): number {
  if (method === 'eth_getLogs') return 16;
  if (method === 'eth_call' || method === 'eth_estimateGas' || method === 'eth_feeHistory') return 2;
  return 1;
}

function getRequestCost(requests: JsonRpcRequest[]): number {
  return requests.reduce((total, request) => (
    total + getBaseRpcRequestCost(typeof request.method === 'string' ? request.method : '')
  ), 0);
}

async function getRpcAccessTier(request: NextRequest): Promise<RpcAccessTier> {
  const { session } = await getChatSessionOrQuickAuthFromRequest(request);
  const address = session?.address?.trim().toLowerCase();

  // A persisted session is created only after wallet/provider verification;
  // require a canonical EVM address before it can receive the higher tier.
  if (address && /^0x[0-9a-f]{40}$/.test(address)) {
    return { address, kind: 'authenticated' };
  }

  return { kind: 'anonymous' };
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
 * Only forward log filters whose range can be bounded locally. JSON-RPC tags
 * such as `earliest` and `latest` are provider-resolved, so allowing either one
 * turns a numeric range guard into an easy archive scan bypass. A block-hash
 * filter is inherently one block and remains safe.
 */
export function validateBaseRpcLogFilter(params: unknown): string | null {
  if (!Array.isArray(params) || params.length === 0) {
    return 'eth_getLogs requires one filter object';
  }
  const filter = params[0];
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    return 'eth_getLogs requires one filter object';
  }

  const { blockHash, fromBlock, toBlock } = filter as {
    blockHash?: unknown;
    fromBlock?: unknown;
    toBlock?: unknown;
  };
  if (blockHash !== undefined) {
    if (
      typeof blockHash !== 'string'
      || !/^0x[0-9a-fA-F]{64}$/.test(blockHash)
      || fromBlock !== undefined
      || toBlock !== undefined
    ) {
      return 'eth_getLogs blockHash must be a 32-byte hash and cannot be combined with a range';
    }
    return null;
  }

  const from = toBlockNumber(fromBlock);
  const to = toBlockNumber(toBlock);
  if (from === null || to === null) {
    return 'eth_getLogs requires explicit hexadecimal fromBlock and toBlock values';
  }
  if (to < from) {
    return 'eth_getLogs toBlock must not precede fromBlock';
  }
  if (to - from > MAX_LOG_BLOCK_RANGE) {
    return `eth_getLogs range is limited to ${MAX_LOG_BLOCK_RANGE} blocks`;
  }

  return null;
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

  const logFilterError = method === 'eth_getLogs'
    ? validateBaseRpcLogFilter(params)
    : null;
  if (logFilterError) {
    return notForwardedError(
      id,
      INVALID_PARAMS,
      logFilterError,
    );
  }

  return null;
}

function validateAnonymousTier(
  payload: JsonRpcRequest,
  allowDevelopmentWrites: boolean,
) {
  const id = (payload?.id ?? null) as JsonRpcId;
  const method = payload.method as string;

  if (
    !isAnonymousBaseRpcMethodAllowed(method)
    && !(allowDevelopmentWrites && DEVELOPMENT_WRITE_METHODS.has(method))
  ) {
    return notForwardedError(
      id,
      METHOD_NOT_FOUND,
      `Method ${method} requires an authenticated session`,
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

  let access: RpcAccessTier;
  try {
    access = await getRpcAccessTier(request);
  } catch (error) {
    const status = error instanceof ChatAuthError && error.status === 503 ? 503 : 401;
    const message = status === 503
      ? 'Authentication session storage is temporarily unavailable'
      : 'Authentication session is invalid';
    return NextResponse.json(notForwardedError(null, INTERNAL_ERROR, message), {
      headers: { 'Cache-Control': 'private, no-store', ...(status === 503 ? { 'Retry-After': '30' } : {}) },
      status,
    });
  }

  if (access.kind === 'anonymous') {
    const anonymousTierErrors = requests.map((entry) => validateAnonymousTier(entry, allowDevelopmentWrites));
    if (anonymousTierErrors.some(Boolean)) {
      const rejected = anonymousTierErrors.map((error, index) => (
        error ?? notForwardedError(
          (requests[index]?.id ?? null) as JsonRpcId,
          INVALID_REQUEST,
          'JSON-RPC batch rejected because another request requires authentication',
        )
      ));
      return NextResponse.json(isBatch ? rejected : rejected[0], {
        headers: { 'Cache-Control': 'private, no-store' },
        status: 401,
      });
    }
  }

  const rateLimit = await enforceRpcRateLimit(request, access, getRequestCost(requests));
  if (rateLimit.status === 'unavailable') {
    return NextResponse.json(notForwardedError(null, INTERNAL_ERROR, 'Rate limiting is temporarily unavailable'), {
      headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '30' },
      status: 503,
    });
  }

  if (rateLimit.status === 'limited') {
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
