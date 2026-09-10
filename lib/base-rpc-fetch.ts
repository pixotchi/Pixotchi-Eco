import {
  BaseRpcError,
  createBaseRpcFailure,
  toBaseRpcWireError,
} from './base-rpc-errors';
import {
  BASE_RPC_MAX_BATCH_SIZE,
  BASE_RPC_MAX_BODY_BYTES,
  BASE_RPC_MAX_FETCH_CONCURRENCY,
} from './base-rpc-policy';

type RpcId = string | number;
type RpcRequest = { id: RpcId; jsonrpc: '2.0'; method: string };
type RpcResponse = { id: RpcId; jsonrpc: '2.0'; result?: unknown; error?: unknown };
type RpcFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type BoundedBaseRpcFetchOptions = {
  fetchFn?: RpcFetch;
  /** Optional lower limits, primarily for deterministic tests. */
  maxBodyBytes?: number;
  maxBatchSize?: number;
  maxConcurrency?: number;
  maxResponseBytes?: number;
};

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const encoder = new TextEncoder();
const metrics = {
  physicalRequests: 0,
  splitBatches: 0,
  rejectedOversize: 0,
  responseFailures: 0,
  totalRequestBodyBytes: 0,
  maxRequestBodyBytes: 0,
};

function addMetric(key: keyof typeof metrics, amount = 1): void {
  metrics[key] = Math.min(Number.MAX_SAFE_INTEGER, metrics[key] + amount);
}

/**
 * Saturating counts and physical request body sizes only; never retain bodies,
 * IDs, URLs, or provider errors. Byte counts include failed dispatch attempts,
 * but exclude requests rejected locally before fetch is called.
 */
export const getBaseRpcFetchMetrics = () => ({ ...metrics });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isId = (value: unknown): value is RpcId =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

const byteLength = (value: string) => encoder.encode(value).byteLength;

function limit(value: number | undefined, maximum: number): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('Base RPC fetch limits must be positive safe integers');
  }
  return Math.min(value, maximum);
}

function failure(category: Parameters<typeof createBaseRpcFailure>[0], local = false) {
  return createBaseRpcFailure(category, local ? { forwarded: false } : undefined);
}

function abortIfNeeded(signal: AbortSignal | null | undefined): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
}

/** Also observes cancellation while a response body is being streamed. */
async function abortable<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return promise;
  abortIfNeeded(signal);
  let abort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([promise, interrupted]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

function wireError(error: unknown, retryAfterMs?: number) {
  const wire = toBaseRpcWireError(error);
  if (wire.data.pixotchi.category === 'rate_limited' && wire.data.pixotchi.retryAfterMs === undefined
    && retryAfterMs !== undefined) wire.data.pixotchi.retryAfterMs = retryAfterMs;
  return wire;
}

function readRetryAfter(response: Response): number | undefined {
  const value = response.headers.get('Retry-After');
  if (!value?.trim()) return undefined;
  const delay = /^\d+(?:\.\d+)?$/.test(value.trim())
    ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.min(300_000, Math.max(0, Math.floor(delay))) : undefined;
}

function errorResponses(requests: RpcRequest[], error: unknown, retryAfterMs?: number): RpcResponse[] {
  const wire = wireError(error, retryAfterMs);
  return requests.map(({ id }) => ({ jsonrpc: '2.0', id, error: wire }));
}

function jsonResponse(responses: RpcResponse[], isBatch: boolean): Response {
  return new Response(JSON.stringify(isBatch ? responses : responses[0]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isWireError(value: unknown): value is Record<string, unknown> & { code: number; message: string } {
  return isRecord(value) && Number.isSafeInteger(value.code) && typeof value.message === 'string';
}

/** Reject ambiguous chunks rather than letting Viem's positional batch sorting misroute a result. */
function matchResponses(value: unknown, requests: RpcRequest[], retryAfterMs?: number): RpcResponse[] {
  if (isRecord(value) && value.id === null && value.jsonrpc === '2.0'
    && isWireError(value.error) && !Object.hasOwn(value, 'result')) {
    return errorResponses(requests, value.error, retryAfterMs);
  }

  const received = Array.isArray(value) ? value : [value];
  if (received.length !== requests.length) throw failure('malformed_response');
  const expected = new Set(requests.map(({ id }) => id));
  const byId = new Map<RpcId, RpcResponse>();
  for (const row of received) {
    if (!isRecord(row) || row.jsonrpc !== '2.0' || !isId(row.id)
      || !expected.has(row.id) || byId.has(row.id)) {
      throw failure('malformed_response');
    }
    const hasResult = Object.hasOwn(row, 'result');
    const hasError = Object.hasOwn(row, 'error');
    if (hasResult === hasError || (hasError && !isWireError(row.error))) {
      throw failure('malformed_response');
    }
    byId.set(row.id, hasError
      ? { jsonrpc: '2.0', id: row.id, error: wireError(row.error, retryAfterMs) }
      : { jsonrpc: '2.0', id: row.id, result: row.result });
  }
  return requests.map(({ id }) => byId.get(id)!);
}

type ResponseBudget = { received: number; exhausted: boolean };

async function readResponse(
  response: Response,
  maximum: number,
  budget: ResponseBudget,
  signal: AbortSignal | null | undefined,
): Promise<string> {
  const declaredSize = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declaredSize) && declaredSize > maximum) {
    if (response.body) void response.body.cancel().catch(() => {});
    throw failure('malformed_response');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let complete = false;
  try {
    while (true) {
      abortIfNeeded(signal);
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      budget.received += value.byteLength;
      if (budget.received > maximum) {
        budget.exhausted = true;
        throw failure('malformed_response');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    complete = true;
    return text;
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * Viem fetch adapter for the same-origin proxy. It preserves HTTP batching and
 * treats each serialized RPC call (including aggregate3 calldata) as indivisible.
 * Only the surrounding JSON array is packed into smaller physical requests.
 */
export function createBoundedBaseRpcFetch(options: BoundedBaseRpcFetchOptions = {}): RpcFetch {
  const maxBodyBytes = limit(options.maxBodyBytes, BASE_RPC_MAX_BODY_BYTES);
  const maxBatchSize = limit(options.maxBatchSize, BASE_RPC_MAX_BATCH_SIZE);
  const maxConcurrency = limit(options.maxConcurrency, BASE_RPC_MAX_FETCH_CONCURRENCY);
  const maxResponseBytes = limit(options.maxResponseBytes, MAX_RESPONSE_BYTES);
  const fetchFn: RpcFetch = options.fetchFn ?? ((input, init) => fetch(input, init));

  return async (input, init) => {
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
    const signal = init?.signal ?? request?.signal;
    abortIfNeeded(signal);
    let body: string;
    if (typeof init?.body === 'string') body = init.body;
    else if (init?.body == null && request) {
      body = await abortable(request.clone().text(), signal);
    } else {
      throw new BaseRpcError('fetch request', failure('invalid_request', true));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new BaseRpcError('fetch request', failure('invalid_request', true));
    }
    const isBatch = Array.isArray(parsed);
    const values: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    const ids = new Set<RpcId>();
    const requests: RpcRequest[] = [];
    for (const value of values) {
      if (!isRecord(value) || value.jsonrpc !== '2.0' || !isId(value.id)
        || typeof value.method !== 'string' || ids.has(value.id)) {
        throw new BaseRpcError('fetch request', failure('invalid_request', true));
      }
      ids.add(value.id);
      requests.push(value as RpcRequest);
    }
    if (!requests.length) throw new BaseRpcError('fetch request', failure('invalid_request', true));

    const encoded = requests.map((value) => JSON.stringify(value));
    const sizes = encoded.map(byteLength);
    // Check every indivisible member before dispatch: an oversized later member
    // must not leave earlier requests already in flight.
    if (sizes.some((size) => size + (isBatch ? 2 : 0) > maxBodyBytes)) {
      addMetric('rejectedOversize');
      throw new BaseRpcError('fetch request', failure('request_too_large', true));
    }

    const chunks: { requests: RpcRequest[]; body: string; bytes: number; offset: number }[] = [];
    let start = 0;
    while (start < requests.length) {
      let end = start;
      let bytes = isBatch ? 2 : 0;
      while (end < requests.length && end - start < maxBatchSize) {
        const next = sizes[end] + (end > start ? 1 : 0);
        if (bytes + next > maxBodyBytes) break;
        bytes += next;
        end += 1;
      }
      chunks.push({
        requests: requests.slice(start, end),
        body: isBatch ? `[${encoded.slice(start, end).join(',')}]` : encoded[start],
        bytes,
        offset: start,
      });
      start = end;
    }

    // Reserve enough output space for every ID to receive a bounded error even
    // if another chunk exhausts the response budget. Successes replace these
    // placeholders only when the combined serialized response still fits.
    const responses = errorResponses(requests, failure('malformed_response'));
    let outputBytes = byteLength(JSON.stringify(isBatch ? responses : responses[0]));
    if (outputBytes > maxResponseBytes) {
      throw new BaseRpcError('fetch response', failure('malformed_response', true));
    }
    const responseSizes = responses.map((value) => byteLength(JSON.stringify(value)));
    const budget: ResponseBudget = { received: 0, exhausted: false };
    const headers = new Headers(init?.headers ?? request?.headers);
    // A caller-supplied Content-Length describes the original logical batch.
    headers.delete('Content-Length');
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (chunks.length > 1) addMetric('splitBatches');
    let cursor = 0;

    const processChunk = async (chunk: typeof chunks[number]) => {
      let result: RpcResponse[];
      let retryAfterMs: number | undefined;
      try {
        abortIfNeeded(signal);
        if (budget.exhausted) throw failure('malformed_response');
        addMetric('physicalRequests');
        addMetric('totalRequestBodyBytes', chunk.bytes);
        metrics.maxRequestBodyBytes = Math.max(metrics.maxRequestBodyBytes, chunk.bytes);
        let response: Response;
        try {
          const pending = fetchFn(input, { ...init, method: init?.method ?? request?.method ?? 'POST', headers, body: chunk.body, signal });
          // An injected fetch may ignore cancellation; dispose any late body.
          void pending.then((late) => {
            if (signal?.aborted && late.body) void late.body.cancel().catch(() => {});
          }, () => {});
          response = await abortable(pending, signal);
        } catch (error) {
          abortIfNeeded(signal);
          throw failure(error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network');
        }
        retryAfterMs = readRetryAfter(response);
        let value: unknown;
        try {
          value = JSON.parse(await readResponse(response, maxResponseBytes, budget, signal));
        } catch (error) {
          abortIfNeeded(signal);
          // Valid HTTP statuses are structural, unlike formatted provider text.
          if (!response.ok && !budget.exhausted) {
            throw { status: response.status };
          }
          throw error;
        }
        if (!response.ok && !(isRecord(value) && isWireError(value.error))
          && !(Array.isArray(value) && value.every((row) => isRecord(row) && isWireError(row.error)))) {
          throw { status: response.status };
        }
        result = matchResponses(value, chunk.requests, retryAfterMs);
      } catch (error) {
        abortIfNeeded(signal);
        addMetric('responseFailures');
        // Unknown JSON/stream errors are malformed response failures; structured
        // local failures and HTTP statuses retain their dedicated categories.
        const safeError = isRecord(error) && ('category' in error || 'status' in error)
          ? error : failure('malformed_response');
        result = errorResponses(chunk.requests, safeError, retryAfterMs);
      }

      const nextSizes = result.map((value) => byteLength(JSON.stringify(value)));
      const oldBytes = responseSizes.slice(chunk.offset, chunk.offset + result.length).reduce((sum, size) => sum + size, 0);
      const nextBytes = nextSizes.reduce((sum, size) => sum + size, 0);
      if (outputBytes - oldBytes + nextBytes > maxResponseBytes) {
        addMetric('responseFailures');
        return;
      }
      outputBytes += nextBytes - oldBytes;
      result.forEach((value, index) => {
        responses[chunk.offset + index] = value;
        responseSizes[chunk.offset + index] = nextSizes[index];
      });
    };

    await Promise.all(Array.from({ length: Math.min(maxConcurrency, chunks.length) }, async () => {
      while (cursor < chunks.length) {
        abortIfNeeded(signal);
        const chunk = chunks[cursor++];
        await processChunk(chunk);
      }
    }));
    abortIfNeeded(signal);
    return jsonResponse(responses, isBatch);
  };
}
