import { createPublicClient, http, isAddress, fallback } from 'viem';
import { mainnet, base } from 'viem/chains';
import { redis } from './redis';
import { getMainnetRpcConfig } from './env-config';

const BASE_COIN_TYPE = (BigInt(0x8000_0000) | BigInt(base.id));

const CACHE_PREFIX = 'ens:name:';
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

let ensClient: ReturnType<typeof createPublicClient> | null = null;

function createMainnetTransport() {
  const { endpoints, fallback: defaultEndpoint } = getMainnetRpcConfig();
  const urls = endpoints.length > 0 ? endpoints : [defaultEndpoint];

  const transports = urls.map((url, index) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`🔗 ENS RPC Endpoint ${index + 1}: ${url}`);
    }
    return http(url, {
      retryCount: 2,
      retryDelay: 500,
      timeout: 10000,
    });
  });

  return transports.length === 1 ? transports[0] : fallback(transports);
}

function getEnsClient() {
  if (!ensClient) {
    ensClient = createPublicClient({
      chain: mainnet,
      transport: createMainnetTransport(),
    });
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
    console.warn('[ENS Resolver] Failed to read cache', { key, error });
    return null;
  }
}

async function writeCache(key: string, value: string | null) {
  if (!redis) return;
  try {
    await redis.setex(key, CACHE_TTL_SECONDS, value ?? '');
  } catch (error) {
    console.warn('[ENS Resolver] Failed to write cache', { key, error });
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
    return null;
  }

  const cacheKey = `${CACHE_PREFIX}${normalised}`;
  if (!refresh) {
    const cached = await readCache(cacheKey);
    if (cached !== null) {
      return cached;
    }
  }

  try {
    const client = getEnsClient();
    const name = await client.getEnsName({
      address: normalised,
      coinType: BASE_COIN_TYPE,
    });
    await writeCache(cacheKey, name ?? null);
    return name ?? null;
  } catch (error) {
    console.warn('[ENS Resolver] Failed to resolve name', {
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
  const unique = Array.from(new Set(addresses.map((addr) => addr.toLowerCase())));
  const results = await Promise.all(
    unique.map(async (addr) => {
      const name = await resolvePrimaryName(addr, options);
      return [addr, name] as const;
    }),
  );

  return new Map(results);
}
