import { getName, getNames } from '@coinbase/onchainkit/identity';
import { isAddress } from 'viem';
import { redis } from './redis';

const CACHE_PREFIX = 'ens:name:';
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

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

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function sanitiseResolvedName(address: `0x${string}`, value: string | null | undefined): string | null {
  if (!value) return null;

  const lower = value.toLowerCase();
  if (lower === address.toLowerCase()) {
    return null;
  }

  const truncated = truncateAddress(address);
  if (value === truncated) {
    return null;
  }

  return value;
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
    const rawName = await getName({ address: normalised });
    const name = sanitiseResolvedName(normalised, rawName ?? null);
    await writeCache(cacheKey, name);
    return name;
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
  const resultMap = new Map<string, string | null>();

  const cachedEntries: Array<{ address: string; name: string | null }> = [];
  const addressesToFetch: `0x${string}`[] = [];

  for (const addr of unique) {
    const normalised = normaliseAddress(addr);
    if (!normalised) {
      resultMap.set(addr, null);
      continue;
    }

    if (!options.refresh) {
      const cached = await readCache(`${CACHE_PREFIX}${normalised}`);
      if (cached !== null) {
        cachedEntries.push({ address: normalised, name: cached });
        continue;
      }
    }

    addressesToFetch.push(normalised);
  }

  cachedEntries.forEach(({ address, name }) => {
    resultMap.set(address, name);
  });

  if (addressesToFetch.length > 0) {
    try {
      const fetchedNames = await getNames({ addresses: addressesToFetch });

      addressesToFetch.forEach((address, index) => {
        const rawName = Array.isArray(fetchedNames) ? fetchedNames[index] : null;
        const name = sanitiseResolvedName(address, rawName ?? null);
        resultMap.set(address, name);
        writeCache(`${CACHE_PREFIX}${address}`, name).catch((error) => {
          console.warn('[ENS Resolver] Failed to write cache for batch item', { address, error });
        });
      });
    } catch (error) {
      console.warn('[ENS Resolver] Failed batch name lookup', {
        addresses: addressesToFetch,
        error: error instanceof Error ? error.message : String(error),
      });

      await Promise.all(
        addressesToFetch.map(async (address) => {
          const name = await resolvePrimaryName(address, options);
          resultMap.set(address, name);
        }),
      );
    }
  }

  return resultMap;
}
