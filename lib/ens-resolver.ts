import { isAddress } from 'viem';
import { getBaseReadClient, getEthereumEnsClient } from './base-rpc';
import { redis } from './redis';
import { ENS_CONFIG } from './constants';

// Base ENS Registrar contract - resolves addresses to .base.eth names
const BASE_ENS_REGISTRAR = '0x0000000000D8e504002cC26E3Ec46D81971C1664' as const;

// ABI for the nameForAddr function
const BASE_ENS_REGISTRAR_ABI = [
  {
    inputs: [{ name: 'addr', type: 'address' }],
    name: 'nameForAddr',
    outputs: [{ name: 'name', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const getBaseClient = () => getBaseReadClient();
const NAME_LOOKUP_CONCURRENCY = 8;

type NameCacheRead =
  | { status: 'hit'; value: string | null }
  | { status: 'miss' };

function cacheHit(value: unknown): NameCacheRead {
  const name = typeof value === 'string' ? value : String(value);
  // An empty value is the persisted sentinel for a successful lookup with no
  // Basename or ENS. It must remain different from an absent Redis key.
  return { status: 'hit', value: name === '' ? null : name };
}

async function readCache(key: string): Promise<NameCacheRead> {
  if (!redis) return { status: 'miss' };
  try {
    const cached = await redis.get(key);
    if (cached === null || cached === undefined) return { status: 'miss' };
    return cacheHit(cached);
  } catch (error) {
    console.warn('[Identity Resolver] Failed to read cache', { key, error });
    return { status: 'miss' };
  }
}

async function readCaches(keys: string[]): Promise<Map<string, NameCacheRead>> {
  const entries = new Map<string, NameCacheRead>();
  if (!redis || keys.length === 0) return entries;

  try {
    const values = await redis.mget(...keys);
    keys.forEach((key, index) => {
      const value = values[index];
      if (value !== null && value !== undefined) {
        entries.set(key, cacheHit(value));
      }
    });
  } catch (error) {
    console.warn('[Identity Resolver] Failed to read name caches', {
      count: keys.length,
      error,
    });
  }

  return entries;
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
 * Resolve Basename using the Base ENS Registrar contract
 * Calls nameForAddr(address) which returns the .base.eth name
 * Uses the app's custom RPC transport with fallbacks
 */
async function resolveBasename(address: `0x${string}`): Promise<string | null> {
  const client = getBaseClient();

  try {
    const name = await client.readContract({
      address: BASE_ENS_REGISTRAR,
      abi: BASE_ENS_REGISTRAR_ABI,
      functionName: 'nameForAddr',
      args: [address],
    });

    // Return null if empty string
    return name && name.length > 0 ? name : null;
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[Identity Resolver] Basename lookup failed', error);
    }
    return null;
  }
}

/**
 * Resolve an ENS name from Ethereum mainnet when no Basename exists.
 */
async function resolveEnsName(address: `0x${string}`): Promise<string | null> {
  try {
    const name = await getEthereumEnsClient().getEnsName({ address });
    return name && name.length > 0 ? name : null;
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[Identity Resolver] ENS lookup failed', error);
    }
    return null;
  }
}

/**
 * Resolve a single address to its primary display name.
 * Prefers Basename on Base, then falls back to mainnet ENS.
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
    if (cached.status === 'hit') {
      return cached.value;
    }
  }

  try {
    const rawName = (await resolveBasename(normalised)) ?? (await resolveEnsName(normalised));
    const name = sanitiseResolvedName(normalised, rawName ?? null);
    await writeCache(cacheKey, name);
    return name;
  } catch (error) {
    console.warn('[Identity Resolver] Failed to resolve name', {
      address: normalised,
      error: error instanceof Error ? error.message : String(error),
    });
    // Cache the failure to avoid repeated failed lookups
    await writeCache(cacheKey, null);
    return null;
  }
}

/**
 * Resolve multiple addresses to their primary display names.
 */
export async function resolvePrimaryNames(
  addresses: string[],
  options: { refresh?: boolean } = {},
): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set(addresses.map((addr) => addr.toLowerCase())));
  const resultMap = new Map<string, string | null>();

  const normalisedAddresses: `0x${string}`[] = [];

  for (const addr of unique) {
    const normalised = normaliseAddress(addr);
    if (!normalised) {
      resultMap.set(addr, null);
      continue;
    }
    normalisedAddresses.push(normalised);
  }

  const cachedEntries = options.refresh
    ? new Map<string, NameCacheRead>()
    : await readCaches(normalisedAddresses.map((address) => `${ENS_CONFIG.CACHE_PREFIX}${address}`));
  const addressesToFetch: `0x${string}`[] = [];

  for (const address of normalisedAddresses) {
    const cached = cachedEntries.get(`${ENS_CONFIG.CACHE_PREFIX}${address}`);
    if (cached?.status === 'hit') {
      resultMap.set(address, cached.value);
      continue;
    }

    addressesToFetch.push(address);
  }

  if (addressesToFetch.length > 0) {
    let nextIndex = 0;
    const resolveNext = async () => {
      while (nextIndex < addressesToFetch.length) {
        const address = addressesToFetch[nextIndex++];
        try {
          // The batch cache was already checked above, so skip its second
          // per-address read before performing the RPC lookup.
          resultMap.set(address, await resolvePrimaryName(address, { refresh: true }));
        } catch (error) {
          console.warn('[Identity Resolver] Failed to resolve name in batch', { address, error });
          resultMap.set(address, null);
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(NAME_LOOKUP_CONCURRENCY, addressesToFetch.length) },
        resolveNext,
      ),
    );
  }

  return resultMap;
}
