import { createPublicClient, http, isAddress } from 'viem';
import { mainnet, base } from 'viem/chains';
import { redis } from './redis';

const DEFAULT_MAINNET_RPC =
  process.env.VIEM_MAINNET_RPC ||
  process.env.NEXT_PUBLIC_MAINNET_RPC ||
  process.env.MAINNET_RPC_URL ||
  'https://ethereum.publicnode.com';

const CACHE_PREFIX = 'ens:name:';
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

const ENS_DEBUG_ENABLED = process.env.ENABLE_ENS_DEBUG === 'true';

export function ensDebugLog(message: string, context?: Record<string, unknown>) {
  if (!ENS_DEBUG_ENABLED && process.env.NODE_ENV === 'production') {
    return;
  }

  if (context) {
    console.log(`[ENS Resolver] ${message}`, context);
  } else {
    console.log(`[ENS Resolver] ${message}`);
  }
}

let ensClient: ReturnType<typeof createPublicClient> | null = null;
let hasLoggedTransport = false;

function getEnsClient() {
  if (!ensClient) {
    ensClient = createPublicClient({
      chain: mainnet,
      transport: http(DEFAULT_MAINNET_RPC),
    });
  }

  if (!hasLoggedTransport) {
    const usingFallback =
      !process.env.VIEM_MAINNET_RPC &&
      !process.env.NEXT_PUBLIC_MAINNET_RPC &&
      !process.env.MAINNET_RPC_URL;

    ensDebugLog('Initialised ENS public client', {
      transport: usingFallback ? 'public-fallback' : 'custom-env',
    });

    if (usingFallback) {
      ensDebugLog('Using public fallback RPC – set VIEM_MAINNET_RPC for production reliability');
    }

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
      coinType: BigInt(base.id),
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
