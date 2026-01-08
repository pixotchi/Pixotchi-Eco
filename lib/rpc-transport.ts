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

  // Multiple endpoints: use fallback transport WITHOUT ranking
  // This gives sequential failover without background polling:
  // - First request goes to endpoint #1
  // - If it fails after retries → tries endpoint #2, etc.
  // - No background pings, no proactive ranking
  return fallback(
    endpoints.map(url => {
      if (!rpcDiagnostics[url]) rpcDiagnostics[url] = { url, ok: 0, fail: 0 };
      return http(url, {
        retryCount: 2, // Retries per endpoint before switching to next
        retryDelay: 1000,
        timeout: 10_000,
      });
    })
    // No rank option = no background polling
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

