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
  // Force health checks to public RPC only (ignore custom endpoints for probes)
  const publicOnly = getPublicHealthRpc();
  return [publicOnly];
};

export const createResilientTransport = (inputEndpoints?: string[]): Transport => {
  const endpoints = (inputEndpoints && inputEndpoints.length > 0) ? inputEndpoints : getRpcEndpoints();
  const target = endpoints[0] || getPublicHealthRpc();

  if (process.env.NODE_ENV === 'development') {
    console.log(`🔗 [Base] Using PUBLIC transport (no fallbacks): ${target}`);
  }

  if (!rpcDiagnostics[target]) rpcDiagnostics[target] = { url: target, ok: 0, fail: 0 };

  // Single endpoint only; no fallback list to avoid multi-RPC health checks
  return http(target, {
    retryCount: 3,
    retryDelay: 1000, // Fixed delay
    timeout: 10_000,
  }) as Transport;
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

