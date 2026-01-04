import { createPublicClient, isAddress, type PublicClient, type Transport } from 'viem';
import { base } from 'viem/chains';
import { redis } from './redis';
import { ENS_CONFIG } from './constants';
import { createResilientTransport } from './rpc-transport';

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

// Create client with our resilient RPC transport (uses app's RPC system)
let baseClient: PublicClient<Transport, typeof base> | null = null;

function getBaseClient(): PublicClient<Transport, typeof base> {
  if (!baseClient) {
    baseClient = createPublicClient({
      chain: base,
      transport: createResilientTransport(),
    });
  }
  return baseClient;
}

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
 * Resolve a single address to its Basename (Base network)
 * Uses the app's custom RPC transport with fallbacks
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
    // Resolve Basename using Base L2 resolver (uses app's RPC system)
    const rawName = await resolveBasename(normalised);
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
 * Resolve multiple addresses to their Basenames (Base network) in batch
 * Uses custom RPC transport with fallbacks
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
    // Resolve all addresses in parallel using our custom resolver
    const results = await Promise.allSettled(
      addressesToFetch.map(async (address) => {
        const name = await resolvePrimaryName(address, options);
        return { address, name };
      })
    );

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        resultMap.set(result.value.address, result.value.name);
      } else {
        // Find the address that failed (by index)
        const index = results.indexOf(result);
        if (index >= 0 && addressesToFetch[index]) {
          resultMap.set(addressesToFetch[index], null);
        }
      }
    });
  }

  return resultMap;
}
