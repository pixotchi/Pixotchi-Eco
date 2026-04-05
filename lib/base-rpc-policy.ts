export type BaseRpcPolicy = 'read' | 'receipt' | 'log' | 'probe';

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

export type BaseRpcVendorDiversityReport = {
  descriptors: BaseRpcEndpointDescriptor[];
  duplicateHosts: string[];
  duplicateVendors: string[];
  uniqueHostCount: number;
  uniqueVendorCount: number;
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

export const validateBaseRpcEndpointDiversity = (
  urls: string[],
  {
    maxEndpointsPerVendor = 2,
    minUniqueVendors = 3,
  }: {
    maxEndpointsPerVendor?: number;
    minUniqueVendors?: number;
  } = {},
): BaseRpcVendorDiversityReport => {
  const descriptors = buildBaseRpcEndpointDescriptors(urls);
  const hostCounts = new Map<string, number>();
  const vendorCounts = new Map<string, number>();

  for (const descriptor of descriptors) {
    hostCounts.set(descriptor.host, (hostCounts.get(descriptor.host) ?? 0) + 1);
    vendorCounts.set(
      descriptor.vendor,
      (vendorCounts.get(descriptor.vendor) ?? 0) + 1,
    );
  }

  const duplicateHostEntries = [...hostCounts.entries()].filter(
    ([, count]) => count > 1,
  );
  const duplicateVendorEntries = [...vendorCounts.entries()].filter(
    ([, count]) => count > 1,
  );
  const duplicateHosts = duplicateHostEntries.map(([host]) => host);
  const duplicateVendors = duplicateVendorEntries.map(([vendor]) => vendor);

  const vendorOverLimitEntries = duplicateVendorEntries.filter(
    ([, count]) => count > maxEndpointsPerVendor,
  );

  if (vendorOverLimitEntries.length > 0) {
    throw new Error(
      `Base RPC endpoints may use at most ${maxEndpointsPerVendor} endpoints per vendor. Over-limit vendors detected: ${vendorOverLimitEntries
        .map(([vendor, count]) => `${vendor} (${count}x)`)
        .join(', ')}`,
    );
  }

  if (vendorCounts.size < minUniqueVendors) {
    throw new Error(
      `Base RPC endpoints must include at least ${minUniqueVendors} unique vendors. Found ${vendorCounts.size}.`,
    );
  }

  return {
    descriptors,
    duplicateHosts,
    duplicateVendors,
    uniqueHostCount: hostCounts.size,
    uniqueVendorCount: vendorCounts.size,
  };
};

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
