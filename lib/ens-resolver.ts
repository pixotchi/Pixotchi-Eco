import { createPublicClient, isAddress, namehash } from 'viem';
import { base, mainnet } from 'viem/chains';
import { normalize } from 'viem/ens';
import { redis } from './redis';
import { ENS_CONFIG } from './constants';
import { createResilientTransport, createMainnetResilientTransport } from './rpc-transport';

// L2 Resolver address on Base for Basenames
const L2_RESOLVER_ADDRESS = '0xC6d566A56A1aFf6508b41f6c90ff131615583BCD' as const;
const BASENAME_SUFFIX = '.base.eth';

// Create clients with our resilient RPC transport
let baseClient: ReturnType<typeof createPublicClient> | null = null;
let mainnetClient: ReturnType<typeof createPublicClient> | null = null;

function getBaseClient() {
  if (!baseClient) {
    baseClient = createPublicClient({
      chain: base,
      transport: createResilientTransport(),
    });
  }
  return baseClient;
}

function getMainnetClient() {
  if (!mainnetClient) {
    mainnetClient = createPublicClient({
      chain: mainnet,
      transport: createMainnetResilientTransport(),
    });
  }
  return mainnetClient;
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
 * Resolve Basename using L2 Resolver on Base chain
 * This uses our custom RPC transport instead of OnchainKit's default
 */
async function resolveBasename(address: `0x${string}`): Promise<string | null> {
  const client = getBaseClient();
  
  try {
    // First try to get the primary name from the L2 resolver's reverse lookup
    const reverseNode = `${address.slice(2).toLowerCase()}.addr.reverse`;
    
    // Use getEnsName which handles the reverse resolution
    const name = await client.getEnsName({
      address,
      universalResolverAddress: L2_RESOLVER_ADDRESS,
    });
    
    return name;
  } catch (error) {
    // L2 resolver might not support this, try alternative approach
    if (process.env.NODE_ENV === 'development') {
      console.log('[Identity Resolver] L2 reverse lookup failed, trying ENS mainnet', error);
    }
    return null;
  }
}

/**
 * Resolve ENS name from Ethereum mainnet using our custom RPC transport
 */
async function resolveEnsName(address: `0x${string}`): Promise<string | null> {
  const client = getMainnetClient();
  
  try {
    const name = await client.getEnsName({ address });
    return name;
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[Identity Resolver] ENS mainnet lookup failed', error);
    }
    return null;
  }
}

/**
 * Resolve a single address to its Basename (Base network) or ENS name
 * Uses custom RPC transport with fallbacks instead of OnchainKit defaults
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
    // Try Basename first (Base L2), then fall back to ENS mainnet
    let rawName = await resolveBasename(normalised);
    
    // If no Basename found, try ENS on mainnet
    if (!rawName) {
      rawName = await resolveEnsName(normalised);
    }
    
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
