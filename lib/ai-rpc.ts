import 'server-only';

import { createPublicClient, fallback, http } from 'viem';
import { base } from 'viem/chains';
import type { PixotchiReadClient } from './contracts';

const DEFAULT_AI_PUBLIC_RPC_URL = 'https://mainnet.base.org';
const AI_RPC_TIMEOUT_MS = Number.parseInt(process.env.AI_RPC_TIMEOUT_MS || '', 10) || 8_000;
const AI_MULTICALL_BATCH_SIZE = Number.parseInt(process.env.AI_RPC_MULTICALL_BATCH_SIZE || '', 10) || 1_024;
const AI_MULTICALL_WAIT_MS = Number.parseInt(process.env.AI_RPC_MULTICALL_WAIT_MS || '', 10) || 16;

type AIRpcClientCache = {
  client: PixotchiReadClient;
  key: string;
};

let cachedAIReadClient: AIRpcClientCache | null = null;

function normalizeRpcUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function dedupeEndpoints(endpoints: Array<string | null>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const endpoint of endpoints) {
    if (!endpoint || seen.has(endpoint)) {
      continue;
    }

    seen.add(endpoint);
    output.push(endpoint);
  }

  return output;
}

export function getAIRpcEndpoints(): string[] {
  const primary = normalizeRpcUrl(process.env.AI_BASE_RPC_URL || process.env.AI_RPC_URL);
  const publicFallback =
    normalizeRpcUrl(process.env.AI_BASE_RPC_PUBLIC_FALLBACK_URL || process.env.AI_RPC_PUBLIC_FALLBACK_URL) ??
    DEFAULT_AI_PUBLIC_RPC_URL;

  return dedupeEndpoints([primary, publicFallback]);
}

export function getAIRpcSourceLabel(): string {
  return 'read-only Base onchain data';
}

export function getAIReadClient(): PixotchiReadClient {
  const endpoints = getAIRpcEndpoints();
  const key = endpoints.join('|');

  if (cachedAIReadClient?.key === key) {
    return cachedAIReadClient.client;
  }

  const transports = endpoints.map((endpoint) =>
    http(endpoint, {
      retryCount: 0,
      timeout: AI_RPC_TIMEOUT_MS,
    })
  );

  const transport = transports.length === 1
    ? transports[0]
    : fallback(transports, {
      name: 'AI Base read RPC',
      rank: false,
      retryCount: 1,
      retryDelay: 150,
    });

  const client = createPublicClient({
    batch: {
      multicall: {
        batchSize: AI_MULTICALL_BATCH_SIZE,
        wait: AI_MULTICALL_WAIT_MS,
      },
    },
    chain: base,
    transport,
  }) as unknown as PixotchiReadClient;

  cachedAIReadClient = { client, key };
  return client;
}
