import { cache } from 'react';
import {
  createPublicClient,
  fallback,
  http,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from 'viem';
import { base } from 'viem/chains';
import { getRpcConfig } from './env-config';

export type BaseRpcMetric = {
  url: string;
  successCount: number;
  failureCount: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureMessage: string | null;
  ewmaLatencyMs: number | null;
};

type MutableBaseRpcMetric = BaseRpcMetric;
type BaseClientKind = 'read' | 'receipt';

const READ_TIMEOUT_MS = 5_000;
const RECEIPT_TIMEOUT_MS = 3_000;
const READ_POLLING_INTERVAL_MS = 300_000;
const RECEIPT_POLLING_INTERVAL_MS = 1_500;
const RANK_INTERVAL_MS = 30_000;
const RANK_SAMPLE_COUNT = 10;
const RANK_TIMEOUT_MS = 1_000;
const LATENCY_ALPHA = 0.2;

const baseRpcMetrics = new Map<string, MutableBaseRpcMetric>();

const ensureMetric = (url: string): MutableBaseRpcMetric => {
  const existing = baseRpcMetrics.get(url);
  if (existing) return existing;

  const created: MutableBaseRpcMetric = {
    url,
    successCount: 0,
    failureCount: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureMessage: null,
    ewmaLatencyMs: null,
  };
  baseRpcMetrics.set(url, created);
  return created;
};

const recordLatency = (url: string, latencyMs: number) => {
  const metric = ensureMetric(url);
  if (metric.ewmaLatencyMs === null) {
    metric.ewmaLatencyMs = latencyMs;
    return;
  }

  metric.ewmaLatencyMs = Math.round(
    metric.ewmaLatencyMs * (1 - LATENCY_ALPHA) + latencyMs * LATENCY_ALPHA,
  );
};

const recordTransportResult = (
  url: string,
  status: 'success' | 'error',
  error?: Error,
) => {
  const metric = ensureMetric(url);
  const now = Date.now();

  if (status === 'success') {
    metric.successCount += 1;
    metric.lastSuccessAt = now;
    return;
  }

  metric.failureCount += 1;
  metric.lastFailureAt = now;
  metric.lastFailureMessage = error?.message ?? 'Unknown Base RPC error';
};

const getTransportUrl = (transport: any): string | null =>
  transport?.value?.url ?? transport?.url ?? null;

const getRetryableFlag = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('connection') ||
    message.includes('429') ||
    message.includes('rate')
  );
};

const initMetrics = (urls: string[]) => {
  urls.forEach((url) => ensureMetric(url));
};

const buildTransport = (kind: BaseClientKind) => {
  const urls = listBaseRpcEndpoints();
  const timeout = kind === 'read' ? READ_TIMEOUT_MS : RECEIPT_TIMEOUT_MS;

  initMetrics(urls);

  return fallback(
    urls.map((url) =>
      http(url, {
        retryCount: 0,
        timeout,
        fetchFn: async (input, init) => {
          const start = Date.now();
          try {
            const response = await fetch(input, init);
            recordLatency(url, Date.now() - start);
            return response;
          } catch (error) {
            recordLatency(url, Date.now() - start);
            throw error;
          }
        },
      }),
    ),
    {
      rank: {
        interval: RANK_INTERVAL_MS,
        sampleCount: RANK_SAMPLE_COUNT,
        timeout: RANK_TIMEOUT_MS,
        weights: {
          latency: 0.3,
          stability: 0.7,
        },
      },
    },
  );
};

const attachMetrics = (client: any) => {
  const transport = client.transport as any;
  if (transport.__pixotchiBaseRpcMetricsAttached) return;

  if (typeof transport.onResponse === 'function') {
    transport.onResponse(
      ({
        status,
        error,
        transport: activeTransport,
      }: {
        status: 'success' | 'error';
        error?: Error;
        transport: any;
      }) => {
        const url = getTransportUrl(activeTransport);
        if (!url) return;
        recordTransportResult(url, status, error);
      },
    );
  }

  transport.__pixotchiBaseRpcMetricsAttached = true;
};

const createBaseClient = (kind: BaseClientKind): PublicClient => {
  const client = createPublicClient({
    chain: base,
    pollingInterval:
      kind === 'read' ? READ_POLLING_INTERVAL_MS : RECEIPT_POLLING_INTERVAL_MS,
    transport: buildTransport(kind),
  }) as any;
  attachMetrics(client);
  const originalRequest = client.request.bind(client);
  client.request = async (
    args: any,
    overrideOptions: any,
  ) => {
    try {
      return await originalRequest(args, overrideOptions);
    } catch (error) {
      if (error instanceof BaseRpcError) throw error;
      throw new BaseRpcError(kind === 'read' ? 'baseRead' : 'baseReceipt', error);
    }
  };
  return client as PublicClient;
};

const getServerBaseReadClient = cache(() => createBaseClient('read'));
const getServerBaseReceiptClient = cache(() => createBaseClient('receipt'));

let browserBaseReadClient: PublicClient | null = null;
let browserBaseReceiptClient: PublicClient | null = null;

export class BaseRpcError extends Error {
  code: 'BASE_RPC_UNAVAILABLE';
  operation: string;
  retryable: boolean;
  endpointsTried: string[];

  constructor(operation: string, error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : `Base RPC operation failed: ${String(error)}`;
    super(message);
    this.name = 'BaseRpcError';
    this.code = 'BASE_RPC_UNAVAILABLE';
    this.operation = operation;
    this.retryable = getRetryableFlag(error);
    this.endpointsTried = listBaseRpcEndpoints();
    if (error instanceof Error && 'cause' in Error.prototype) {
      (this as Error & { cause?: unknown }).cause = error;
    }
  }
}

export const listBaseRpcEndpoints = (): string[] => getRpcConfig().endpoints;

export const getBaseRpcMetrics = (): BaseRpcMetric[] => {
  const endpoints = listBaseRpcEndpoints();
  initMetrics(endpoints);
  return endpoints.map((url) => ({ ...ensureMetric(url) }));
};

export const getBaseReadClient = (): PublicClient => {
  if (typeof window !== 'undefined') {
    browserBaseReadClient ??= createBaseClient('read');
    return browserBaseReadClient;
  }
  return getServerBaseReadClient();
};

export const getBaseReceiptClient = (): PublicClient => {
  if (typeof window !== 'undefined') {
    browserBaseReceiptClient ??= createBaseClient('receipt');
    return browserBaseReceiptClient;
  }
  return getServerBaseReceiptClient();
};

export const waitForBaseReceipt = async (
  hash: Hex,
): Promise<TransactionReceipt> => {
  try {
    return await getBaseReceiptClient().waitForTransactionReceipt({ hash });
  } catch (error) {
    if (error instanceof BaseRpcError) {
      throw new BaseRpcError('waitForBaseReceipt', error);
    }
    throw new BaseRpcError('waitForBaseReceipt', error);
  }
};
