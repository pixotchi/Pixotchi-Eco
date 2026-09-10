import { BaseError, type Hex } from 'viem';

export const BASE_RPC_NOT_FORWARDED_MARKER = 'PIXOTCHI_PROXY_NOT_FORWARDED';
export const BASE_RPC_MAX_REVERT_BYTES = 16_384;
export const BASE_RPC_MAX_ERROR_NODES = 64;

const FAILURE_POLICIES = {
  contract_revert: { code: 3, retryable: false, failover: false, affectsProviderHealth: false, message: 'Contract execution reverted' },
  invalid_request: { code: -32602, retryable: false, failover: false, affectsProviderHealth: false, message: 'RPC request parameters are invalid' },
  unsupported_method: { code: -32601, retryable: false, failover: true, affectsProviderHealth: false, message: 'RPC method is unavailable' },
  rate_limited: { code: -32005, retryable: true, failover: true, affectsProviderHealth: true, message: 'RPC rate limit exceeded' },
  timeout: { code: -32090, retryable: true, failover: true, affectsProviderHealth: true, message: 'RPC request timed out' },
  receipt_timeout: { code: -32090, retryable: true, failover: true, affectsProviderHealth: false, message: 'Transaction receipt confirmation timed out' },
  receipt_not_found: { code: -32001, retryable: true, failover: true, affectsProviderHealth: false, message: 'Transaction receipt could not be found' },
  network: { code: -32091, retryable: true, failover: true, affectsProviderHealth: true, message: 'RPC network connection failed' },
  upstream_unavailable: { code: -32092, retryable: true, failover: true, affectsProviderHealth: true, message: 'RPC service is temporarily unavailable' },
  malformed_response: { code: -32093, retryable: true, failover: true, affectsProviderHealth: true, message: 'RPC returned an invalid response' },
  range_limit: { code: -32094, retryable: false, failover: true, affectsProviderHealth: false, message: 'RPC log block range is too large' },
  request_too_large: { code: -32095, retryable: false, failover: false, affectsProviderHealth: false, message: 'RPC request body is too large' },
  authorization: { code: 4100, retryable: false, failover: false, affectsProviderHealth: false, message: 'RPC request requires authentication' },
  transaction_rejected: { code: -32003, retryable: false, failover: false, affectsProviderHealth: false, message: 'RPC rejected the transaction' },
} as const;

export type BaseRpcFailureCategory = keyof typeof FAILURE_POLICIES;
const failureClassifications = Object.fromEntries(
  Object.keys(FAILURE_POLICIES).map(category => [category, 0]),
) as Record<BaseRpcFailureCategory, number>;

/** Fixed labels and counts only; callers cannot mutate the stored counters. */
export const getBaseRpcErrorMetrics = () => ({ failureClassifications: { ...failureClassifications } });

/** Called once for each failed endpoint invocation, including expected reverts. */
export function recordBaseRpcFailureClassification(error: unknown): void {
  const { category } = classifyBaseRpcError(error);
  failureClassifications[category] = Math.min(Number.MAX_SAFE_INTEGER, failureClassifications[category] + 1);
}

type FailureOptions = {
  code?: number;
  upstreamCode?: number;
  forwarded?: false;
  retryAfterMs?: number;
  revertData?: Hex;
  dataOmitted?: boolean;
};

export type BaseRpcFailure = {
  category: BaseRpcFailureCategory;
  code: number;
  retryable: boolean;
  failover: boolean;
  affectsProviderHealth: boolean;
  message: string;
} & Omit<FailureOptions, 'code'>;

export type BaseRpcWireData = {
  /** Viem's getContractError accepts revert bytes in error.data.data. */
  data?: Hex;
  pixotchi: {
    v: 1;
    category: BaseRpcFailureCategory;
    retryable: boolean;
    forwarded?: false;
    upstreamCode?: number;
    retryAfterMs?: number;
    dataOmitted?: boolean;
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';
const isCode = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= 2_147_483_648;
const isCategory = (value: unknown): value is BaseRpcFailureCategory =>
  typeof value === 'string' && Object.hasOwn(FAILURE_POLICIES, value);
const isHexBytes = (value: unknown): value is Hex =>
  typeof value === 'string' && /^0x(?:[0-9a-f]{2})*$/i.test(value);

/** Normalize primitives only. Neither an upstream message nor its cause escapes. */
export function createBaseRpcFailure(category: BaseRpcFailureCategory, options: FailureOptions = {}): BaseRpcFailure {
  const policy = FAILURE_POLICIES[category];
  const code = category === 'invalid_request' && [-32700, -32600, -32602].includes(options.code ?? 0)
    ? options.code! : policy.code;
  const revertData = isHexBytes(options.revertData) && options.revertData.length <= 2 + BASE_RPC_MAX_REVERT_BYTES * 2
    ? options.revertData : undefined;
  return {
    category, ...policy, code,
    ...(category === 'contract_revert' && revertData !== undefined ? { revertData } : {}),
    ...(options.dataOmitted || (options.revertData !== undefined && revertData === undefined) ? { dataOmitted: true } : {}),
    ...(options.forwarded === false ? { forwarded: false as const } : {}),
    ...(isCode(options.upstreamCode) ? { upstreamCode: options.upstreamCode } : {}),
    ...(typeof options.retryAfterMs === 'number' && Number.isFinite(options.retryAfterMs)
      ? { retryAfterMs: Math.min(300_000, Math.max(0, Math.floor(options.retryAfterMs))) } : {}),
  };
}

/** Includes internal invocation and aggregate wrappers without retaining them. */
export function collectBaseRpcErrors(error: unknown): unknown[] {
  const visited = new Set<unknown>();
  const result: unknown[] = [];
  // Count attempted visits too: an aggregate containing repeated references
  // must not bypass the work budget just because those nodes are already seen.
  let remaining = BASE_RPC_MAX_ERROR_NODES;
  const visit = (value: unknown, depth: number) => {
    if (remaining <= 0) return;
    remaining -= 1;
    if (!value || depth > 8 || visited.has(value)) return;
    visited.add(value);
    result.push(value);
    if (value instanceof AggregateError) {
      for (let index = 0; index < value.errors.length && remaining > 0; index += 1) {
        visit(value.errors[index], depth + 1);
      }
    }
    if (isRecord(value)) {
      for (const key of ['cause', 'lastError', 'error'] as const) {
        if (remaining <= 0) break;
        if (value[key] !== undefined) visit(value[key], depth + 1);
      }
      if (remaining > 0 && isRecord(value.data) && value.data.originalError !== undefined) {
        visit(value.data.originalError, depth + 1);
      }
    }
  };
  visit(error, 0);
  return result;
}

/** Read only our versioned contract; do not classify unrelated wallet errors. */
export function getBaseRpcFailure(error: unknown): BaseRpcFailure | null {
  for (const candidate of collectBaseRpcErrors(error)) {
    if (!isRecord(candidate)) continue;
    if (isCategory(candidate.category) && typeof candidate.retryable === 'boolean' && typeof candidate.failover === 'boolean') {
      return createBaseRpcFailure(candidate.category, candidate as FailureOptions);
    }
    const data = candidate.data;
    if (!isRecord(data) || !isRecord(data.pixotchi)) continue;
    const metadata = data.pixotchi;
    if (metadata.v !== 1 || !isCategory(metadata.category)) continue;
    return createBaseRpcFailure(metadata.category, {
      ...metadata as FailureOptions,
      ...(isCode(candidate.code) ? { code: candidate.code } : {}),
      ...(isHexBytes(data.data) ? { revertData: data.data } : {}),
    });
  }
  return null;
}

/** Only actual provider details or leaf messages, never Viem's formatted body/URL. */
function scopedMessage(candidate: Record<string, unknown>): string {
  if (candidate.name === 'RpcRequestError' && isRecord(candidate.cause) && typeof candidate.cause.message === 'string') {
    return candidate.cause.message.toLowerCase();
  }
  if (typeof candidate.details === 'string') return candidate.details.toLowerCase();
  if (!candidate.cause && !candidate.body && !candidate.url && typeof candidate.message === 'string') {
    return candidate.message.toLowerCase();
  }
  return '';
}

export function classifyBaseRpcError(
  error: unknown,
  { trustEnvelope = true }: { trustEnvelope?: boolean } = {},
): BaseRpcFailure {
  // Only local errors and the same-origin proxy may supply our provenance.
  // A paid provider can return arbitrary error.data and revert messages.
  const existing = trustEnvelope ? getBaseRpcFailure(error) : null;
  if (existing) return existing;
  const candidates = collectBaseRpcErrors(error).filter(isRecord);
  const facts = candidates.map(candidate => ({
    candidate,
    code: typeof candidate.code === 'string' && /^-?\d+$/.test(candidate.code) ? Number(candidate.code) : candidate.code,
    name: typeof candidate.name === 'string' ? candidate.name.toLowerCase() : '',
    message: scopedMessage(candidate),
  }));
  const make = (category: BaseRpcFailureCategory, fact?: typeof facts[number]) => {
    const rawData = fact?.candidate.data;
    const revertData = isHexBytes(rawData) ? rawData : isRecord(rawData) && isHexBytes(rawData.data) ? rawData.data : undefined;
    return createBaseRpcFailure(category, {
      ...(isCode(fact?.code) ? { code: fact.code, upstreamCode: fact.code } : {}),
      ...(revertData !== undefined ? { revertData } : {}),
    });
  };
  // Providers sometimes use invalid-request/params for their subscription limits.
  const range = facts.find(({ message }) => (message.includes('eth_getlogs') || message.includes('block range'))
    && /free tier|upgrade to|limited to|too large|exceed|maximum|limit/.test(message));
  if (range) return make('range_limit', range);
  const receiptTimeout = facts.find(({ name }) => name === 'waitfortransactionreceipttimeouterror');
  if (receiptTimeout) return make('receipt_timeout', receiptTimeout);
  const receiptMissing = facts.find(({ name }) => name === 'transactionreceiptnotfounderror' || name === 'transactionnotfounderror');
  if (receiptMissing) return make('receipt_not_found', receiptMissing);
  const revert = facts.find(({ code, name, message }) => code === 3 || name === 'contractfunctionrevertederror' || /execution reverted/.test(message));
  if (revert) return make('contract_revert', revert);
  const invalid = facts.find(({ code }) => code === -32700 || code === -32600 || code === -32602);
  if (invalid) return make('invalid_request', invalid);
  const unsupported = facts.find(({ code }) => code === -32601 || code === -32004 || code === 4200);
  if (unsupported) return make('unsupported_method', unsupported);
  const authorization = facts.find(({ code }) => code === 4001 || code === 4100 || (typeof code === 'number' && code >= 5700 && code <= 5760));
  if (authorization) return make('authorization', authorization);
  const rejected = facts.find(({ code, message }) => code === -32003
    || /insufficient funds|nonce too low|intrinsic gas too low|transaction underpriced|already known/.test(message));
  if (rejected) return make('transaction_rejected', rejected);
  const rate = facts.find(({ code, candidate, message }) => code === 429 || code === -32005 || candidate.status === 429 || /rate limit|over rate limit/.test(message));
  if (rate) return make('rate_limited', rate);
  const tooLarge = facts.find(({ candidate }) => candidate.status === 413);
  if (tooLarge) return make('request_too_large', tooLarge);
  const authHttp = facts.find(({ candidate }) => candidate.status === 401 || candidate.status === 403);
  if (authHttp) return make('authorization', authHttp);
  const timeout = facts.find(({ code, name, message, candidate }) => name.includes('timeout')
    || (typeof code === 'string' && /^ETIMEDOUT$/i.test(code)) || candidate.status === 408 || candidate.status === 504
    || /timed out|timeout/.test(message));
  if (timeout) return make('timeout', timeout);
  const network = facts.find(({ code, name, message }) => name === 'aborterror' || name.includes('network')
    || (typeof code === 'string' && /ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|CONNECT_TIMEOUT/i.test(code))
    || /fetch failed|failed to fetch|network|connection|socket|aborted/.test(message));
  if (network) return make('network', network);
  const malformed = facts.find(({ name }) => name === 'responsebodytoolargeerror' || name === 'syntaxerror');
  if (malformed) return make('malformed_response', malformed);
  return make('upstream_unavailable', facts.find(({ code }) => isCode(code)));
}

export const isRetryableBaseRpcError = (error: unknown): boolean => getBaseRpcFailure(error)?.retryable ?? false;

export function toBaseRpcWireError(error: unknown): { code: number; message: string; data: BaseRpcWireData } {
  const failure = classifyBaseRpcError(error);
  return {
    code: failure.code,
    message: `${failure.message}${failure.forwarded === false ? ` [${BASE_RPC_NOT_FORWARDED_MARKER}]` : ''}`,
    data: {
      ...(failure.revertData !== undefined ? { data: failure.revertData } : {}),
      pixotchi: {
        v: 1, category: failure.category, retryable: failure.retryable,
        ...(failure.forwarded === false ? { forwarded: false as const } : {}),
        ...(failure.upstreamCode !== undefined ? { upstreamCode: failure.upstreamCode } : {}),
        ...(failure.retryAfterMs !== undefined ? { retryAfterMs: failure.retryAfterMs } : {}),
        ...(failure.dataOmitted ? { dataOmitted: true } : {}),
      },
    },
  };
}

/** Viem keeps this BaseError and its numeric code instead of creating UnknownRpcError(-1). */
export class BaseRpcError extends BaseError {
  readonly kind = 'BASE_RPC_UNAVAILABLE';
  readonly code: number;
  readonly operation: string;
  readonly retryable: boolean;
  readonly endpointsTried: string[];
  readonly data: BaseRpcWireData;

  constructor(operation: string, error: unknown, options: { endpointsTried?: string[] } = {}) {
    const wire = toBaseRpcWireError(error);
    super(wire.message, { name: 'BaseRpcError' });
    this.code = wire.code;
    this.operation = operation;
    this.retryable = wire.data.pixotchi.retryable;
    this.data = wire.data;
    this.endpointsTried = options.endpointsTried ?? (error instanceof BaseRpcError ? error.endpointsTried : []);
  }
}
