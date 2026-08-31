export type BaseRpcPolicy = 'read' | 'receipt' | 'log' | 'probe';

/**
 * Maximum JSON-RPC calls the browser may pack into one HTTP request.
 *
 * The same-origin proxy (app/api/rpc/route.ts) rejects an oversized batch as a
 * whole, so the client-side batcher and the server-side cap must be one number.
 * They were 40 and 20: any batch of 21-40 calls came back as a single HTTP 400
 * and failed every call inside it at once, with no per-call failover possible.
 */
export const BASE_RPC_MAX_BATCH_SIZE = 20;

/**
 * Maximum calldata, in bytes, viem packs into one Multicall3 aggregate3 call.
 */
export const BASE_RPC_MAX_MULTICALL_CALLDATA_BYTES = 8_192;

/**
 * Largest body the proxy must accept, derived from what the browser batcher can
 * legitimately emit rather than picked independently.
 *
 * This is the same defect as the batch-count mismatch above, one layer down: a
 * flat 128KB cap sat below the client's own worst case of
 * `20 requests x 8192 bytes of hex-encoded calldata` (~330KB), so a busy screen
 * could produce a request the proxy rejected wholesale with HTTP 413 — every
 * read in it failing at once, with no per-call failover available.
 *
 * Deriving it keeps the guard meaningful (nothing larger than our own client can
 * produce is accepted) while making it impossible for the two to drift apart.
 */
const JSON_RPC_REQUEST_OVERHEAD_BYTES = 512;

export const BASE_RPC_MAX_BODY_BYTES =
  BASE_RPC_MAX_BATCH_SIZE
    * (BASE_RPC_MAX_MULTICALL_CALLDATA_BYTES * 2 + JSON_RPC_REQUEST_OVERHEAD_BYTES)
  + 1_024;

export type BaseRpcVendor =
  | 'alchemy'
  | 'ankr'
  | 'base'
  | 'coinbase'
  | 'infura'
  | 'publicnode'
  | string;

export type BaseRpcEndpointDescriptor = {
  url: string;
  host: string;
  vendor: BaseRpcVendor;
};

export type BaseRpcRankSample = {
  success: boolean;
  latencyMs: number;
  at: number;
};

export type BaseRpcRankWeights = {
  latency: number;
  stability: number;
};

export type BaseRpcExecutionWave = {
  urls: string[];
  hedgeDelayMs: number | null;
};

const DEFAULT_RANK_WEIGHTS: BaseRpcRankWeights = {
  latency: 0.3,
  stability: 0.7,
};

const normalizeRpcHost = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
};

export const deriveBaseRpcVendor = (url: string): BaseRpcVendor => {
  const host = normalizeRpcHost(url);

  if (host.includes('alchemy.com')) return 'alchemy';
  if (host.includes('api.developer.coinbase.com')) return 'coinbase';
  if (host.includes('coinbase.com')) return 'coinbase';
  if (host.includes('rpc.ankr.com')) return 'ankr';
  if (host.includes('infura.io')) return 'infura';
  if (host.includes('publicnode.com')) return 'publicnode';
  if (host.includes('base.org')) return 'base';

  return host;
};

export const buildBaseRpcEndpointDescriptors = (
  urls: string[],
): BaseRpcEndpointDescriptor[] =>
  urls.map((url) => ({
    url,
    host: normalizeRpcHost(url),
    vendor: deriveBaseRpcVendor(url),
  }));

const computeAverageLatency = (samples: BaseRpcRankSample[]): number => {
  const successful = samples.filter((sample) => sample.success);
  if (successful.length === 0) return Number.POSITIVE_INFINITY;
  return (
    successful.reduce((total, sample) => total + sample.latencyMs, 0) /
    successful.length
  );
};

const computeSuccessRate = (samples: BaseRpcRankSample[]): number => {
  if (samples.length === 0) return 0;
  return (
    samples.reduce((total, sample) => total + (sample.success ? 1 : 0), 0) /
    samples.length
  );
};

export const rankBaseRpcEndpoints = (
  descriptors: BaseRpcEndpointDescriptor[],
  samplesByUrl: Map<string, BaseRpcRankSample[]>,
  weights: BaseRpcRankWeights = DEFAULT_RANK_WEIGHTS,
): string[] => {
  const latencies = descriptors.map((descriptor) =>
    computeAverageLatency(samplesByUrl.get(descriptor.url) ?? []),
  );
  const fastestLatency = latencies.find(Number.isFinite) ?? 1;

  return descriptors
    .map((descriptor, index) => {
      const samples = samplesByUrl.get(descriptor.url) ?? [];
      const successRate = computeSuccessRate(samples);
      const averageLatency = computeAverageLatency(samples);
      const latencyScore = Number.isFinite(averageLatency)
        ? Math.min(1, fastestLatency / Math.max(averageLatency, 1))
        : 0;
      const score =
        weights.stability * successRate + weights.latency * latencyScore;

      return {
        averageLatency,
        index,
        score,
        successRate,
        url: descriptor.url,
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.successRate !== left.successRate) {
        return right.successRate - left.successRate;
      }
      if (left.averageLatency !== right.averageLatency) {
        return left.averageLatency - right.averageLatency;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.url);
};

export const buildBaseRpcExecutionPlan = (
  policy: BaseRpcPolicy,
  orderedUrls: readonly string[],
  {
    fallbackRetryCount = 0,
    hedgeDelayMs = 300,
  }: {
    fallbackRetryCount?: number;
    hedgeDelayMs?: number;
  } = {},
): BaseRpcExecutionWave[] => {
  if (orderedUrls.length === 0) return [];

  if (policy === 'receipt' || policy === 'log') {
    if (orderedUrls.length === 1) {
      return [{ urls: [orderedUrls[0]], hedgeDelayMs: null }];
    }

    return [
      {
        urls: [orderedUrls[0], orderedUrls[1]],
        hedgeDelayMs,
      },
      ...orderedUrls.slice(2).map((url) => ({
        urls: [url],
        hedgeDelayMs: null,
      })),
    ];
  }

  const waves: BaseRpcExecutionWave[] = [];
  for (let round = 0; round <= fallbackRetryCount; round += 1) {
    for (const url of orderedUrls) {
      waves.push({ urls: [url], hedgeDelayMs: null });
    }
  }
  return waves;
};
