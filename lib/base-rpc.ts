import { cache } from 'react';
import {
  createPublicClient,
  createTransport,
  http,
  type Hex,
  type TransactionReceipt,
  type Transport,
} from 'viem';
import { base } from 'viem/chains';
import { getRpcConfig } from './env-config';
import {
  type BaseRpcEndpointDescriptor,
  type BaseRpcExecutionWave,
  type BaseRpcPolicy,
  buildBaseRpcEndpointDescriptors,
  buildBaseRpcExecutionPlan,
  rankBaseRpcEndpoints,
} from './base-rpc-policy';

export type BaseRpcEndpointStatus = {
  url: string;
  vendor: string;
  policy: BaseRpcPolicy;
  healthy: boolean;
  rank: number;
  ewmaLatencyMs: number | null;
  successCount: number;
  failureCount: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureMessage: string | null;
  lastUsedAt: number | null;
  coolingDown: boolean;
  consecutiveFailures: number;
  openUntilAt: number | null;
};

export type BaseRpcStatusSnapshot = {
  generatedAt: number;
  rankedUrls: string[];
  endpoints: Array<{
    url: string;
    vendor: string;
    rank: number;
    read: BaseRpcEndpointStatus;
    receipt: BaseRpcEndpointStatus;
    log: BaseRpcEndpointStatus;
    probe: BaseRpcEndpointStatus;
  }>;
  policies: Record<BaseRpcPolicy, BaseRpcEndpointStatus[]>;
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    avgLatencyMs: number | null;
    liveSuccessCount: number;
    liveFailureCount: number;
    coolingDown: number;
    uniqueVendorCount: number;
  };
};

type MutableBaseRpcEndpointStatus = BaseRpcEndpointStatus;

type BaseRpcPolicyConfig = {
  timeoutMs: number;
  fallbackRetryCount: number;
  retryDelayMs: number;
  rankIntervalMs: number;
  sampleCount: number;
  rankTimeoutMs: number;
  hedgeDelayMs: number;
  pollingIntervalMs: number;
};

type BaseRpcRankSample = {
  success: boolean;
  latencyMs: number;
  at: number;
};

type BaseRpcCircuitState = {
  consecutiveFailures: number;
  openUntilAt: number;
};

const LATENCY_ALPHA = 0.2;
const RANKING_CALL_ADDRESS = '0xeb4e16c804AE9275a655AbBc20cD0658A91F9235' as const;
const TOTAL_SUPPLY_SELECTOR = '0x18160ddd' as const;
const HTTP_BATCH_SIZE = 40;
const HTTP_BATCH_WAIT_MS = 16;
const MULTICALL_BATCH_SIZE = 8_192;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

// Hedge delays govern when we start a parallel request to a backup RPC.
// Keeping them overridable lets ops dial them up during Base congestion
// without a redeploy, in which case fixed 300 ms can be too aggressive.
function resolveHedgeDelayMs(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5_000) return fallback;
  return parsed;
}
const RECEIPT_HEDGE_DELAY_MS = resolveHedgeDelayMs('BASE_RPC_RECEIPT_HEDGE_MS', 300);
const LOG_HEDGE_DELAY_MS = resolveHedgeDelayMs('BASE_RPC_LOG_HEDGE_MS', 300);

const POLICY_CONFIG: Record<BaseRpcPolicy, BaseRpcPolicyConfig> = {
  read: {
    timeoutMs: 4_500,
    fallbackRetryCount: 1,
    hedgeDelayMs: 0,
    pollingIntervalMs: 300_000,
    rankIntervalMs: 15_000,
    rankTimeoutMs: 800,
    retryDelayMs: 150,
    sampleCount: 8,
  },
  receipt: {
    timeoutMs: 2_500,
    fallbackRetryCount: 0,
    hedgeDelayMs: RECEIPT_HEDGE_DELAY_MS,
    pollingIntervalMs: 1_500,
    rankIntervalMs: 15_000,
    rankTimeoutMs: 800,
    retryDelayMs: 150,
    sampleCount: 8,
  },
  log: {
    timeoutMs: 5_000,
    fallbackRetryCount: 0,
    hedgeDelayMs: LOG_HEDGE_DELAY_MS,
    pollingIntervalMs: 5_000,
    rankIntervalMs: 15_000,
    rankTimeoutMs: 800,
    retryDelayMs: 150,
    sampleCount: 8,
  },
  probe: {
    timeoutMs: 3_000,
    fallbackRetryCount: 0,
    hedgeDelayMs: 0,
    pollingIntervalMs: 15_000,
    rankIntervalMs: 15_000,
    rankTimeoutMs: 800,
    retryDelayMs: 150,
    sampleCount: 8,
  },
};

const policyMetrics = new Map<
  BaseRpcPolicy,
  Map<string, MutableBaseRpcEndpointStatus>
>();
const policyCircuitState = new Map<BaseRpcPolicy, Map<string, BaseRpcCircuitState>>();
const requestClientCache = new Map<string, ReturnType<ReturnType<typeof http>>>();
const readRankSamples = new Map<string, BaseRpcRankSample[]>();

let readRankOrder: string[] = [];
let readRankRefreshedAt = 0;
let readRankRefreshPromise: Promise<void> | null = null;
let probeRefreshPromise: Promise<void> | null = null;

const getConfiguredDescriptors = (): BaseRpcEndpointDescriptor[] =>
  buildBaseRpcEndpointDescriptors(listBaseRpcEndpoints());

const getDescriptorByUrl = (url: string): BaseRpcEndpointDescriptor => {
  return (
    getConfiguredDescriptors().find((descriptor) => descriptor.url === url) ?? {
      host: url,
      url,
      vendor: 'custom',
    }
  );
};

const getPolicyMetricMap = (
  policy: BaseRpcPolicy,
): Map<string, MutableBaseRpcEndpointStatus> => {
  const existing = policyMetrics.get(policy);
  if (existing) return existing;

  const created = new Map<string, MutableBaseRpcEndpointStatus>();
  policyMetrics.set(policy, created);
  return created;
};

const ensurePolicyMetric = (
  policy: BaseRpcPolicy,
  url: string,
): MutableBaseRpcEndpointStatus => {
  const map = getPolicyMetricMap(policy);
  const existing = map.get(url);
  if (existing) return existing;

  const descriptor = getDescriptorByUrl(url);
  const created: MutableBaseRpcEndpointStatus = {
    url,
    vendor: descriptor.vendor,
    policy,
    healthy: false,
    rank: 0,
    ewmaLatencyMs: null,
    successCount: 0,
    failureCount: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureMessage: null,
    lastUsedAt: null,
    coolingDown: false,
    consecutiveFailures: 0,
    openUntilAt: null,
  };
  map.set(url, created);
  return created;
};

const getPolicyCircuitStateMap = (
  policy: BaseRpcPolicy,
): Map<string, BaseRpcCircuitState> => {
  const existing = policyCircuitState.get(policy);
  if (existing) return existing;

  const created = new Map<string, BaseRpcCircuitState>();
  policyCircuitState.set(policy, created);
  return created;
};

const ensureCircuitState = (
  policy: BaseRpcPolicy,
  url: string,
): BaseRpcCircuitState => {
  const map = getPolicyCircuitStateMap(policy);
  const existing = map.get(url);
  if (existing) return existing;

  const created: BaseRpcCircuitState = {
    consecutiveFailures: 0,
    openUntilAt: 0,
  };
  map.set(url, created);
  return created;
};

const recomputeReadRank = () => {
  const descriptors = getConfiguredDescriptors();
  if (descriptors.length === 0) {
    readRankOrder = [];
    return;
  }

  readRankOrder = rankBaseRpcEndpoints(descriptors, readRankSamples);
  if (readRankOrder.length === 0) {
    readRankOrder = descriptors.map((descriptor) => descriptor.url);
  }
};

const getOrderedUrls = (
  policy: BaseRpcPolicy,
  inputUrls?: readonly string[],
): string[] => {
  const configured = listBaseRpcEndpoints();
  const urls = inputUrls ? [...inputUrls] : configured;

  if (readRankOrder.length === 0) {
    readRankOrder = [...configured];
  }

  const rankIndex = new Map(
    readRankOrder.map((url, index) => [url, index] as const),
  );
  const circuitState = getPolicyCircuitStateMap(policy);
  const now = Date.now();

  return urls
    .map((url, index) => ({
      coolingDown: (circuitState.get(url)?.openUntilAt ?? 0) > now,
      index,
      rank: rankIndex.get(url) ?? Number.MAX_SAFE_INTEGER,
      url,
    }))
    .sort((left, right) => {
      if (left.coolingDown !== right.coolingDown) {
        return left.coolingDown ? 1 : -1;
      }
      if (left.rank !== right.rank) return left.rank - right.rank;
      return left.index - right.index;
    })
    .map((entry) => entry.url);
};

const getRequestClient = (
  url: string,
  timeoutMs: number,
): ReturnType<ReturnType<typeof http>> => {
  const cacheKey = `${url}:${timeoutMs}`;
  const existing = requestClientCache.get(cacheKey);
  if (existing) return existing;

  const client = http(url, {
    batch: {
      batchSize: HTTP_BATCH_SIZE,
      wait: HTTP_BATCH_WAIT_MS,
    },
    retryCount: 0,
    retryDelay: 0,
    timeout: timeoutMs,
  })({
    chain: base,
    retryCount: 0,
    timeout: timeoutMs,
  });
  requestClientCache.set(cacheKey, client);
  return client;
};

const updateLatency = (
  metric: MutableBaseRpcEndpointStatus,
  latencyMs: number,
) => {
  if (metric.ewmaLatencyMs === null) {
    metric.ewmaLatencyMs = latencyMs;
    return;
  }

  metric.ewmaLatencyMs = Math.round(
    metric.ewmaLatencyMs * (1 - LATENCY_ALPHA) + latencyMs * LATENCY_ALPHA,
  );
};

const isRateLimitError = (error?: Error) => {
  if (!error) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('over rate limit')
  );
};

const isConnectivityError = (error?: Error) => {
  if (!error) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('connection')
  );
};

const isServerSideRpcError = (error?: Error) => {
  if (!error) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('bad gateway') ||
    message.includes('service unavailable') ||
    message.includes('gateway timeout') ||
    message.includes('internal server error')
  );
};

const isExpectedApplicationError = (error?: Error) => {
  if (!error) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('execution reverted') ||
    message.includes('reverted') ||
    message.includes('contract function') ||
    message.includes('user rejected') ||
    message.includes('insufficient funds') ||
    message.includes('intrinsic gas too low') ||
    message.includes('nonce too low') ||
    message.includes('replacement transaction underpriced') ||
    message.includes('transaction underpriced') ||
    message.includes('already known') ||
    message.includes('invalid params') ||
    message.includes('invalid argument') ||
    message.includes('invalid address') ||
    message.includes('abi') ||
    message.includes('decode')
  );
};

const shouldAffectProviderHealth = (
  method: string,
  error?: Error,
) => {
  if (!error) return true;
  if (
    isRateLimitError(error) ||
    isConnectivityError(error) ||
    isServerSideRpcError(error)
  ) {
    return true;
  }

  if (method === 'eth_call') {
    return false;
  }

  if (isExpectedApplicationError(error)) {
    return false;
  }

  return true;
};

const recordPolicyResult = (
  policy: BaseRpcPolicy,
  url: string,
  {
    affectsHealth = true,
    error,
    latencyMs,
    status,
  }: {
    affectsHealth?: boolean;
    error?: Error;
    latencyMs: number;
    status: 'success' | 'error';
  },
) => {
  const metric = ensurePolicyMetric(policy, url);
  const circuitState = ensureCircuitState(policy, url);
  const now = Date.now();

  updateLatency(metric, latencyMs);
  metric.lastUsedAt = now;

  if (status === 'success') {
    metric.successCount += 1;
    metric.lastSuccessAt = now;
    metric.healthy = true;
    circuitState.consecutiveFailures = 0;
    circuitState.openUntilAt = 0;
    if (policy === 'read') {
      recordRankSample(url, {
        at: now,
        latencyMs,
        success: true,
      });
    }
    metric.coolingDown = false;
    metric.consecutiveFailures = 0;
    metric.openUntilAt = null;
    return;
  }

  if (!affectsHealth) {
    return;
  }

  metric.failureCount += 1;
  metric.lastFailureAt = now;
  metric.lastFailureMessage = error?.message ?? 'Unknown Base RPC error';
  metric.healthy = false;
  circuitState.consecutiveFailures += 1;
  if (
    isRateLimitError(error) ||
    circuitState.consecutiveFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD
  ) {
    circuitState.openUntilAt = now + CIRCUIT_BREAKER_COOLDOWN_MS;
  }
  metric.coolingDown = circuitState.openUntilAt > now;
  metric.consecutiveFailures = circuitState.consecutiveFailures;
  metric.openUntilAt = circuitState.openUntilAt > now ? circuitState.openUntilAt : null;
  if (policy === 'read') {
    recordRankSample(url, {
      at: now,
      latencyMs,
      success: false,
    });
  }
};

const sleep = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const shouldRefreshReadRank = () => {
  const interval = POLICY_CONFIG.read.rankIntervalMs;
  return Date.now() - readRankRefreshedAt >= interval;
};

const recordRankSample = (
  url: string,
  sample: BaseRpcRankSample,
) => {
  const samples = readRankSamples.get(url) ?? [];
  samples.push(sample);
  const maxSamples = POLICY_CONFIG.read.sampleCount;
  readRankSamples.set(url, samples.slice(-maxSamples));
  recomputeReadRank();
  readRankRefreshedAt = sample.at;
};

const pingEndpointForRanking = async (url: string) => {
  const started = Date.now();
  try {
    await getRequestClient(url, POLICY_CONFIG.read.rankTimeoutMs).request({
      method: 'eth_blockNumber',
      params: [],
    });
    recordRankSample(url, {
      at: Date.now(),
      latencyMs: Date.now() - started,
      success: true,
    });
  } catch {
    recordRankSample(url, {
      at: Date.now(),
      latencyMs: Date.now() - started,
      success: false,
    });
  }
};

const refreshReadRank = async () => {
  const descriptors = getConfiguredDescriptors();
  if (descriptors.length === 0) return;

  const bootstrapUrls = descriptors
    .filter((descriptor) => (readRankSamples.get(descriptor.url)?.length ?? 0) === 0)
    .map((descriptor) => descriptor.url);

  if (bootstrapUrls.length > 0) {
    await Promise.all(bootstrapUrls.map((url) => pingEndpointForRanking(url)));
  } else {
    recomputeReadRank();
  }
  readRankRefreshedAt = Date.now();
};

const ensureReadRank = async ({
  awaitFresh = false,
}: {
  awaitFresh?: boolean;
} = {}) => {
  if (readRankOrder.length === 0) {
    readRankOrder = listBaseRpcEndpoints();
  }

  if (!shouldRefreshReadRank()) return;

  if (typeof window !== 'undefined') {
    readRankRefreshedAt = Date.now();
    return;
  }

  if (!readRankRefreshPromise) {
    readRankRefreshPromise = refreshReadRank().finally(() => {
      readRankRefreshPromise = null;
    });
  }

  if (awaitFresh || readRankRefreshedAt === 0) {
    await readRankRefreshPromise;
  }
};

const probeEndpoint = async (url: string) => {
  const started = Date.now();
  try {
    const client = getRequestClient(url, POLICY_CONFIG.probe.timeoutMs);
    const [blockNumber, callResult] = await Promise.all([
      client.request({
        method: 'eth_blockNumber',
        params: [],
      }),
      client.request({
        method: 'eth_call',
        params: [
          { data: TOTAL_SUPPLY_SELECTOR, to: RANKING_CALL_ADDRESS },
          'latest',
        ],
      }),
    ]);

    if (!blockNumber || !callResult) {
      throw new Error('Probe returned empty result');
    }

    recordPolicyResult('probe', url, {
      latencyMs: Date.now() - started,
      status: 'success',
    });
  } catch (error) {
    recordPolicyResult('probe', url, {
      error: error as Error,
      latencyMs: Date.now() - started,
      status: 'error',
    });
  }
};

const refreshProbeMetrics = async () => {
  await ensureReadRank({ awaitFresh: true });

  const descriptors = getConfiguredDescriptors();
  if (descriptors.length === 0) return;
  await Promise.all(descriptors.map((descriptor) => probeEndpoint(descriptor.url)));
};

const ensureProbeMetrics = async () => {
  if (!probeRefreshPromise) {
    probeRefreshPromise = refreshProbeMetrics().finally(() => {
      probeRefreshPromise = null;
    });
  }
  await probeRefreshPromise;
};

class BaseRpcInvocationError extends Error {
  attemptedUrls: string[];
  lastError: UntypedValue;

  constructor(message: string, attemptedUrls: string[], lastError: UntypedValue) {
    super(message);
    this.name = 'BaseRpcInvocationError';
    this.attemptedUrls = attemptedUrls;
    this.lastError = lastError;
  }
}

const invokeEndpoint = async (
  policy: BaseRpcPolicy,
  url: string,
  method: string,
  params: UntypedValue[],
) => {
  const started = Date.now();

  try {
    const result = await getRequestClient(url, POLICY_CONFIG[policy].timeoutMs).request({
      method,
      params,
    });
    recordPolicyResult(policy, url, {
      latencyMs: Date.now() - started,
      status: 'success',
    });
    return result;
  } catch (error) {
    const typedError = error as Error;
    recordPolicyResult(policy, url, {
      affectsHealth: shouldAffectProviderHealth(method, typedError),
      error: typedError,
      latencyMs: Date.now() - started,
      status: 'error',
    });
    throw error;
  }
};

type BaseRpcInvokeFn = (
  policy: BaseRpcPolicy,
  url: string,
  method: string,
  params: UntypedValue[],
) => Promise<UntypedValue>;

const executeSingleWaveWithInvoker = async (
  policy: BaseRpcPolicy,
  wave: BaseRpcExecutionWave,
  method: string,
  params: UntypedValue[],
  attemptedUrls: string[],
  {
    invoke = invokeEndpoint,
    wait = sleep,
  }: {
    invoke?: BaseRpcInvokeFn;
    wait?: typeof sleep;
  } = {},
) => {
  if (wave.urls.length === 1) {
    attemptedUrls.push(wave.urls[0]);
    return invoke(policy, wave.urls[0], method, params);
  }

  const [primaryUrl, secondaryUrl] = wave.urls;
  const hedgeDelayMs = wave.hedgeDelayMs ?? 0;

  attemptedUrls.push(primaryUrl);
  const primaryPromise = invoke(policy, primaryUrl, method, params);

  const primaryOutcome = await Promise.race([
    primaryPromise
      .then((value) => ({ kind: 'success' as const, value }))
      .catch((error) => ({ error, kind: 'error' as const })),
    wait(hedgeDelayMs).then(() => ({ kind: 'hedge' as const })),
  ]);

  if (primaryOutcome.kind === 'success') {
    return primaryOutcome.value;
  }

  attemptedUrls.push(secondaryUrl);

  if (primaryOutcome.kind === 'error') {
    try {
      return await invoke(policy, secondaryUrl, method, params);
    } catch (secondaryError) {
      throw new AggregateError(
        [primaryOutcome.error, secondaryError],
        'Both hedged Base RPC transports failed',
      );
    }
  }

  const secondaryPromise = invoke(policy, secondaryUrl, method, params);

  try {
    return await Promise.any([primaryPromise, secondaryPromise]);
  } catch (error) {
    throw new AggregateError(
      error instanceof AggregateError ? error.errors : [error],
      'Both hedged Base RPC transports failed',
    );
  }
};

const executeSingleWave = async (
  policy: BaseRpcPolicy,
  wave: BaseRpcExecutionWave,
  method: string,
  params: UntypedValue[],
  attemptedUrls: string[],
) =>
  executeSingleWaveWithInvoker(policy, wave, method, params, attemptedUrls);

const executePolicyRequest = async (
  policy: BaseRpcPolicy,
  method: string,
  params: UntypedValue[] = [],
  inputUrls?: readonly string[],
) => {
  if (!inputUrls) {
    await ensureReadRank({ awaitFresh: readRankRefreshedAt === 0 });
    if (shouldRefreshReadRank()) void ensureReadRank();
  }

  const orderedUrls = getOrderedUrls(policy, inputUrls);
  const attemptedUrls: string[] = [];
  const executionPlan = buildBaseRpcExecutionPlan(policy, orderedUrls, {
    fallbackRetryCount: POLICY_CONFIG[policy].fallbackRetryCount,
    hedgeDelayMs: POLICY_CONFIG[policy].hedgeDelayMs,
  });

  let lastError: UntypedValue = new Error('Base RPC request failed before execution');
  let previousWaveSignature: string | null = null;

  for (const wave of executionPlan) {
    try {
      return await executeSingleWave(policy, wave, method, params, attemptedUrls);
    } catch (error) {
      lastError = error;
      const signature = wave.urls.join(',');
      if (
        previousWaveSignature &&
        signature !== previousWaveSignature &&
        POLICY_CONFIG[policy].retryDelayMs > 0 &&
        wave.urls.length === 1
      ) {
        await sleep(POLICY_CONFIG[policy].retryDelayMs);
      }
      previousWaveSignature = signature;
    }
  }

  throw new BaseRpcInvocationError(
    `Base RPC ${policy} request failed for method ${method}`,
    attemptedUrls,
    lastError,
  );
};

const createBaseTransport = (
  policy: BaseRpcPolicy,
  inputUrls?: readonly string[],
): Transport<'http', { policy: BaseRpcPolicy; url: string }> =>
  ({ chain }) =>
    createTransport(
      {
        key: `base-${policy}`,
        name: `Base ${policy} RPC`,
        request: async ({ method, params }) => {
          try {
            return (await executePolicyRequest(
              policy,
              method,
              (params ?? []) as UntypedValue[],
              inputUrls,
            )) as never;
          } catch (error) {
            if (error instanceof BaseRpcError) throw error;
            throw new BaseRpcError(policy, error);
          }
        },
        retryCount: 0,
        retryDelay: 0,
        timeout: POLICY_CONFIG[policy].timeoutMs,
        type: 'http',
      },
      {
        policy,
        url:
          inputUrls?.[0] ??
          chain?.rpcUrls.default.http[0] ??
          getPrimaryRpcEndpoint(),
      },
    );

const createBaseClient = (policy: 'read' | 'receipt' | 'log') =>
  createPublicClient({
    batch: {
      multicall: {
        batchSize: MULTICALL_BATCH_SIZE,
        wait: HTTP_BATCH_WAIT_MS,
      },
    },
    chain: base,
    pollingInterval: POLICY_CONFIG[policy].pollingIntervalMs,
    transport: createBaseTransport(policy),
  });

const getServerBaseReadClient = cache(() => createBaseClient('read'));
const getServerBaseReceiptClient = cache(() => createBaseClient('receipt'));
const getServerBaseLogClient = cache(() => createBaseClient('log'));

let browserBaseReadClient: ReturnType<typeof createBaseClient> | null = null;
let browserBaseReceiptClient: ReturnType<typeof createBaseClient> | null = null;
let browserBaseLogClient: ReturnType<typeof createBaseClient> | null = null;

const getRetryableFlag = (error: UntypedValue): boolean => {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes('timeout') ||
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('connection') ||
    message.includes('429') ||
    message.includes('rate')
  );
};

export class BaseRpcError extends Error {
  code: 'BASE_RPC_UNAVAILABLE';
  operation: string;
  retryable: boolean;
  endpointsTried: string[];

  constructor(operation: string, error: UntypedValue) {
    const invocationError =
      error instanceof BaseRpcInvocationError ? error : null;
    const rootError = invocationError?.lastError ?? error;
    const message =
      rootError instanceof Error
        ? rootError.message
        : `Base RPC operation failed: ${String(rootError)}`;

    super(message);
    this.name = 'BaseRpcError';
    this.code = 'BASE_RPC_UNAVAILABLE';
    this.operation = operation;
    this.retryable = getRetryableFlag(rootError);
    this.endpointsTried =
      invocationError?.attemptedUrls.length
        ? invocationError.attemptedUrls
        : listBaseRpcEndpoints();

    if (rootError instanceof Error) {
      (this as Error & { cause?: UntypedValue }).cause = rootError;
    }
  }
}

const buildPolicyStatus = (
  policy: BaseRpcPolicy,
  descriptor: BaseRpcEndpointDescriptor,
  rankMap: Map<string, number>,
): BaseRpcEndpointStatus => {
  const metric = getPolicyMetricMap(policy).get(descriptor.url);
  const probeMetric = getPolicyMetricMap('probe').get(descriptor.url);
  const circuitState = getPolicyCircuitStateMap(policy).get(descriptor.url);
  const openUntilAt =
    circuitState && circuitState.openUntilAt > Date.now()
      ? circuitState.openUntilAt
      : null;

  return {
    url: descriptor.url,
    vendor: descriptor.vendor,
    policy,
    healthy: metric?.healthy ?? probeMetric?.healthy ?? false,
    rank: rankMap.get(descriptor.url) ?? Number.MAX_SAFE_INTEGER,
    ewmaLatencyMs: metric?.ewmaLatencyMs ?? probeMetric?.ewmaLatencyMs ?? null,
    successCount: metric?.successCount ?? 0,
    failureCount: metric?.failureCount ?? 0,
    lastSuccessAt: metric?.lastSuccessAt ?? null,
    lastFailureAt: metric?.lastFailureAt ?? null,
    lastFailureMessage:
      metric?.lastFailureMessage ?? probeMetric?.lastFailureMessage ?? null,
    lastUsedAt: metric?.lastUsedAt ?? null,
    coolingDown: openUntilAt !== null,
    consecutiveFailures: circuitState?.consecutiveFailures ?? 0,
    openUntilAt,
  };
};

export const listBaseRpcEndpoints = (): string[] => getRpcConfig().endpoints;

export const getPrimaryRpcEndpoint = (): string =>
  listBaseRpcEndpoints()[0] || 'https://mainnet.base.org';

export const createBaseRpcTransport = (
  policy: BaseRpcPolicy = 'read',
  inputEndpoints?: string[],
): Transport => createBaseTransport(policy, inputEndpoints);

export const getBaseReadClient = () => {
  if (typeof window !== 'undefined') {
    browserBaseReadClient ??= createBaseClient('read');
    return browserBaseReadClient;
  }

  return getServerBaseReadClient();
};

export const getBaseReceiptClient = () => {
  if (typeof window !== 'undefined') {
    browserBaseReceiptClient ??= createBaseClient('receipt');
    return browserBaseReceiptClient;
  }

  return getServerBaseReceiptClient();
};

export const getBaseLogClient = () => {
  if (typeof window !== 'undefined') {
    browserBaseLogClient ??= createBaseClient('log');
    return browserBaseLogClient;
  }

  return getServerBaseLogClient();
};

export const getBaseTransactionReceipt = async (
  hash: Hex,
): Promise<TransactionReceipt> => {
  try {
    return await getBaseReceiptClient().getTransactionReceipt({ hash });
  } catch (error) {
    throw new BaseRpcError('getBaseTransactionReceipt', error);
  }
};

export const waitForBaseReceipt = async (
  hash: Hex,
): Promise<TransactionReceipt> => {
  try {
    return await getBaseReceiptClient().waitForTransactionReceipt({ hash });
  } catch (error) {
    throw new BaseRpcError('waitForBaseReceipt', error);
  }
};

export const getBaseRpcStatusSnapshot = async ({
  refreshProbe = false,
}: {
  refreshProbe?: boolean;
} = {}): Promise<BaseRpcStatusSnapshot> => {
  await ensureReadRank({ awaitFresh: true });
  if (refreshProbe) {
    await ensureProbeMetrics();
  }

  const descriptors = getConfiguredDescriptors();
  const rankedUrls = getOrderedUrls('read');
  const rankMap = new Map(
    rankedUrls.map((url, index) => [url, index + 1] as const),
  );

  const policies: Record<BaseRpcPolicy, BaseRpcEndpointStatus[]> = {
    read: descriptors.map((descriptor) =>
      buildPolicyStatus('read', descriptor, rankMap),
    ),
    receipt: descriptors.map((descriptor) =>
      buildPolicyStatus('receipt', descriptor, rankMap),
    ),
    log: descriptors.map((descriptor) =>
      buildPolicyStatus('log', descriptor, rankMap),
    ),
    probe: descriptors.map((descriptor) =>
      buildPolicyStatus('probe', descriptor, rankMap),
    ),
  };

  const endpoints = descriptors.map((descriptor, index) => ({
    url: descriptor.url,
    vendor: descriptor.vendor,
    rank: rankMap.get(descriptor.url) ?? index + 1,
    read: policies.read[index],
    receipt: policies.receipt[index],
    log: policies.log[index],
    probe: policies.probe[index],
  }));

  const healthyEndpoints = endpoints.filter(
    (endpoint) => endpoint.probe.healthy && endpoint.read.healthy,
  );
  const avgLatencyMs =
    healthyEndpoints.length > 0
      ? Math.round(
          healthyEndpoints.reduce(
            (total, endpoint) =>
              total + (endpoint.probe.ewmaLatencyMs ?? endpoint.read.ewmaLatencyMs ?? 0),
            0,
          ) / healthyEndpoints.length,
        )
      : null;

  return {
    generatedAt: Date.now(),
    rankedUrls,
    endpoints,
    policies,
    summary: {
      total: endpoints.length,
      healthy: healthyEndpoints.length,
      degraded: endpoints.length - healthyEndpoints.length,
      avgLatencyMs,
      liveSuccessCount: endpoints.reduce(
        (total, endpoint) =>
          total +
          endpoint.read.successCount +
          endpoint.receipt.successCount +
          endpoint.log.successCount,
        0,
      ),
      liveFailureCount: endpoints.reduce(
        (total, endpoint) =>
          total +
          endpoint.read.failureCount +
          endpoint.receipt.failureCount +
          endpoint.log.failureCount,
        0,
      ),
      coolingDown: endpoints.filter((endpoint) => endpoint.read.coolingDown).length,
      uniqueVendorCount: new Set(
        descriptors.map((descriptor) => descriptor.vendor),
      ).size,
    },
  };
};
