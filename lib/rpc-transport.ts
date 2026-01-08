import { fallback, http, type Transport } from 'viem';
import { getRpcConfig } from './env-config';

type RpcDiag = { url: string; ok: number; fail: number; lastError?: string };
const rpcDiagnostics: Record<string, RpcDiag> = {};

export const getRpcDiagnostics = (): RpcDiag[] => Object.values(rpcDiagnostics);

// Public health-check endpoint (kept off custom RPCs)
export const getPublicHealthRpc = (): string =>
  process.env.NEXT_PUBLIC_RPC_PUBLIC_HEALTH || 'https://base-rpc.publicnode.com';

// ============================================
// Base Chain RPC Configuration
// ============================================

export const getRpcEndpoints = (): string[] => {
  // Use the central config which includes primary + 4 backups
  const config = getRpcConfig();
  return config.endpoints;
};

export const createResilientTransport = (inputEndpoints?: string[]): Transport => {
  const endpoints = (inputEndpoints && inputEndpoints.length > 0) ? inputEndpoints : getRpcEndpoints();

  // If only one endpoint, return simple http transport
  if (endpoints.length === 1) {
    const target = endpoints[0];
    if (!rpcDiagnostics[target]) rpcDiagnostics[target] = { url: target, ok: 0, fail: 0 };
    return http(target, {
      retryCount: 3,
      retryDelay: 1000,
      timeout: 10_000,
    });
  }

  // If multiple endpoints, use fallback transport with tuned ranking
  // Ranking pings each endpoint periodically to score by latency/stability
  return fallback(
    endpoints.map(url => {
      if (!rpcDiagnostics[url]) rpcDiagnostics[url] = { url, ok: 0, fail: 0 };
      return http(url, {
        retryCount: 2, // Retries per endpoint before switching
        retryDelay: 1000,
        timeout: 10_000,
      });
    }),
    {
      rank: {
        interval: 30_000,  // Ping every 30 seconds (reduced from default 10s)
        sampleCount: 5,    // Track last 5 samples for ranking
        timeout: 5_000,    // 5s timeout for health pings
        weights: {
          latency: 0.3,    // 30% weight on speed
          stability: 0.7,  // 70% weight on reliability
        },
      },
    }
  );
};


// Explicit public-only transport for walletconnect/health probes
export const createPublicHealthTransport = (): Transport => {
  const url = getPublicHealthRpc();
  if (process.env.NODE_ENV === 'development') {
    console.log(`🔗 [Base] Using PUBLIC health RPC for walletconnect: ${url}`);
  }
  if (!rpcDiagnostics[url]) rpcDiagnostics[url] = { url, ok: 0, fail: 0 };
  return http(url, {
    retryCount: 3,
    retryDelay: 1000, // Fixed delay
    timeout: 10_000,
  }) as Transport;
};

export const getPrimaryRpcEndpoint = (): string => {
  const endpoints = getRpcEndpoints();
  return endpoints[0] || 'https://mainnet.base.org';
};

