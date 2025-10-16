import { createPublicClient, http, isAddress, fallback } from 'viem';
import { mainnet, base } from 'viem/chains';
import { redis } from './redis';
import { getRpcConfig } from './env-config';

const { endpoints: baseRpcEndpoints } = getRpcConfig();

const CACHE_PREFIX = 'ens:name:';
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

export function ensDebugLog(message: string, context?: Record<string, unknown>) {
  if (context) {
    console.log(`[ENS Resolver] ${message}`, context);
  } else {
    console.log(`[ENS Resolver] ${message}`);
  }
}

let ensClient: ReturnType<typeof createPublicClient> | null = null;
let hasLoggedTransport = false;

function buildEnsTransport() {
  const transports = baseRpcEndpoints.map((endpoint) => http(endpoint));

  if (transports.length === 0) {
    ensDebugLog('No RPC endpoints configured; using public fallback', {
      fallback: 'https://mainnet.base.org',
    });
    return http('https://mainnet.base.org');
  }

  if (transports.length === 1) {
    ensDebugLog('Using single ENS transport', { endpoint: baseRpcEndpoints[0] });
    return transports[0];
  }

  ensDebugLog('Using fallback ENS transport with multiple endpoints', {
    endpoints: baseRpcEndpoints,
  });
  return fallback(transports);
}

function getEnsClient() {
  if (!ensClient) {
    ensClient = createPublicClient({
      chain: mainnet,
      transport: buildEnsTransport(),
    });
  }

  if (!hasLoggedTransport) {
    hasLoggedTransport = true;
  }

  return ensClient;
}

async function readCache(key: string): Promise<string | null> {
  if (!redis) return null;
  try {
    const cached = await redis.get(key);
    if (cached === null || cached === undefined) return null;
    const value = typeof cached === 'string' ? cached : String(cached);
    return value === '' ? null : value;
  } catch (error) {
    ensDebugLog('Failed to read cache', { key, error });
    return null;
  }
}

async function writeCache(key: string, value: string | null) {
  if (!redis) return;
  try {
    await redis.setex(key, CACHE_TTL_SECONDS, value ?? '');
  } catch (error) {
    ensDebugLog('Failed to write cache', { key, error });
  }
}

function normaliseAddress(address: string): `0x${string}` | null {
  if (!isAddress(address)) return null;
  return address.toLowerCase() as `0x${string}`;
}

export async function resolvePrimaryName(
  address: string,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<string | null> {
  const normalised = normaliseAddress(address);
  if (!normalised) {
    ensDebugLog('Skipping resolution for invalid address', { address });
    return null;
  }

  const cacheKey = `${CACHE_PREFIX}${normalised}`;
  if (!refresh) {
    const cached = await readCache(cacheKey);
    if (cached !== null) {
      ensDebugLog('Cache hit', { address: normalised, name: cached });
      return cached;
    }
  }

  try {
    ensDebugLog('Resolving via Viem', { address: normalised });
    const client = getEnsClient();
    const name = await client.getEnsName({
      address: normalised,
      chainId: base.id,
    });
    ensDebugLog('Resolved name', { address: normalised, name });
    await writeCache(cacheKey, name ?? null);
    return name ?? null;
  } catch (error) {
    ensDebugLog('Failed to resolve name', {
      address: normalised,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function resolvePrimaryNames(
  addresses: string[],
  options: { refresh?: boolean } = {},
): Promise<Map<string, string | null>> {
  ensDebugLog('Batch resolve request', { count: addresses.length });
  const unique = Array.from(new Set(addresses.map((addr) => addr.toLowerCase())));
  const results = await Promise.all(
    unique.map(async (addr) => {
      const name = await resolvePrimaryName(addr, options);
      return [addr, name] as const;
    }),
  );

  const resolvedCount = results.filter(([, value]) => value !== null).length;
  ensDebugLog('Batch resolve completed', {
    total: unique.length,
    resolved: resolvedCount,
  });

  return new Map(results);
}
