import { fallback, http, type Transport } from 'viem';
import { getRpcConfig } from './env-config';

type RpcDiag = { url: string; ok: number; fail: number; lastError?: string };
const rpcDiagnostics: Record<string, RpcDiag> = {};

export const getRpcDiagnostics = (): RpcDiag[] => Object.values(rpcDiagnostics);

// ============================================
// Base Chain RPC Configuration
// ============================================

export const getRpcEndpoints = (): string[] => {
  const { endpoints } = getRpcConfig();
  if (process.env.NODE_ENV === 'development') {
    console.log(`🔗 [Base] Configured ${endpoints.length} RPC endpoint(s)`);
  }
  return endpoints;
};

const createTransportList = (endpoints: string[], label = 'RPC') => {
  return endpoints.map((url, index) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`🔗 [${label}] Endpoint ${index + 1}: ${url}`);
    }
    const transport = http(url, {
      retryCount: 2,
      retryDelay: 500,
      timeout: 10_000,
    }) as Transport;
    if (!rpcDiagnostics[url]) rpcDiagnostics[url] = { url, ok: 0, fail: 0 };
    return transport;
  });
};

export const createResilientTransport = (inputEndpoints?: string[]): Transport => {
  const endpoints = (inputEndpoints && inputEndpoints.length > 0) ? inputEndpoints : getRpcEndpoints();
  const transports = createTransportList(endpoints, 'Base');
  if (transports.length === 0) {
    return http('https://mainnet.base.org');
  }
  return transports.length === 1 ? transports[0] : fallback(transports);
};

export const getPrimaryRpcEndpoint = (): string => {
  const endpoints = getRpcEndpoints();
  return endpoints[0] || 'https://mainnet.base.org';
};

