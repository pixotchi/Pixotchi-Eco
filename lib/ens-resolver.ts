import { getName, getNames } from '@coinbase/onchainkit/identity';
import { isAddress } from 'viem';
import { base } from 'viem/chains';
import { redis } from './redis';
import { ENS_CONFIG } from './constants';

async function readCache(key: string): Promise<string | null> {
  if (!redis) return null;
  try {
    const cached = await redis.get(key);
    if (cached === null || cached === undefined) return null;
    const value = typeof cached === 'string' ? cached : String(cached);
    return value === '' ? null : value;
  } catch (error) {
    console.warn('[Identity Resolver] Failed to read cache', { key, error });
    return null;
  }
}

async function writeCache(key: string, value: string | null) {
  if (!redis) return;
  try {
    await redis.setex(key, ENS_CONFIG.CACHE_TTL_SECONDS, value ?? '');
  } catch (error) {
    console.warn('[Identity Resolver] Failed to write cache', { key, error });
  }
}

function normaliseAddress(address: string): `0x${string}` | null {
  if (!isAddress(address)) return null;
  return address.toLowerCase() as `0x${string}`;
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Sanitise resolved name to avoid storing truncated addresses
 * Follows OnchainKit pattern: returns null if name equals address or its truncation
 */
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

/**
 * Resolve a single address to its Basename (Base network) or ENS name
 * Follows OnchainKit's getName() pattern but uses Base chain for Basename resolution
 */
export async function resolvePrimaryName(
  address: string,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<string | null> {
  const normalised = normaliseAddress(address);
  if (!normalised) {
    return null;
  }

  const cacheKey = `${ENS_CONFIG.CACHE_PREFIX}${normalised}`;
  if (!refresh) {
    const cached = await readCache(cacheKey);
    if (cached !== null) {
      return cached;
    }
  }

  try {
    // Resolve Basename on Base chain (follows OnchainKit guide with chain parameter)
    const rawName = await getName({ address: normalised, chain: base });
    const name = sanitiseResolvedName(normalised, rawName ?? null);
    await writeCache(cacheKey, name);
    return name;
  } catch (error) {
    console.warn('[Identity Resolver] Failed to resolve name', {
      address: normalised,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Resolve multiple addresses to their Basenames (Base network) in batch
 * Follows OnchainKit's getNames() pattern but uses Base chain
 * More efficient than calling resolvePrimaryName multiple times
 */
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
      const cached = await readCache(`${ENS_CONFIG.CACHE_PREFIX}${normalised}`);
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
      // Batch resolve Basenames on Base chain (follows OnchainKit guide)
      const fetchedNames = await getNames({ addresses: addressesToFetch, chain: base });

      addressesToFetch.forEach((address, index) => {
        const rawName = Array.isArray(fetchedNames) ? fetchedNames[index] : null;
        const name = sanitiseResolvedName(address, rawName ?? null);
        resultMap.set(address, name);
        writeCache(`${ENS_CONFIG.CACHE_PREFIX}${address}`, name).catch((error) => {
          console.warn('[Identity Resolver] Failed to write cache for batch item', { address, error });
        });
      });
    } catch (error) {
      console.warn('[Identity Resolver] Failed batch name lookup', {
        addresses: addressesToFetch,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback: resolve individually
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
