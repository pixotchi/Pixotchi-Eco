/**
 * Solana Twin Address Resolution
 * Resolves Solana wallet addresses to their deterministic Twin addresses on Base
 * 
 * MAINNET ONLY - No devnet support
 */

import { createPublicClient, http, fallback } from 'viem';
import { base } from 'viem/chains';
import {
  BRIDGE_ABI,
  getBridgeConfig,
  getPixotchiSolanaConfig,
} from './solana-constants';
import { getRpcEndpoints } from './rpc-transport';

// ============ Types ============

export interface TwinAddressInfo {
  solanaAddress: string;
  twinAddress: string;
  isDeployed: boolean;
  wsolBalance: bigint;
  seedBalance: bigint;
}

// ============ RPC Configuration ============

// Get RPC URLs from environment with fallbacks (avoid mainnet.base.org to prevent CORS 403)
const BASE_RPC_URLS = (() => {
  const fromEnv = getRpcEndpoints();
  if (fromEnv.length > 0) return fromEnv;
  // Last-resort public RPC that allows browser POSTs better than mainnet.base.org
  return ['https://base-rpc.publicnode.com'];
})();

// Log which RPC is being used (only in development)
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  console.log('[SolanaTwin] Using Base RPC:', BASE_RPC_URLS[0]?.substring(0, 50) + '...');
}

// Create transports with retry config
const transports = BASE_RPC_URLS.map(url => 
  http(url, {
    retryCount: 3,
    retryDelay: 1000, // Fixed delay
    timeout: 10000,
  })
);

// ============ Viem Client ============

// Create a viem client for Base mainnet with fallback transports
const baseClient = createPublicClient({
  chain: base,
  transport: fallback(transports, {
    rank: {
        interval: 60_000,
        sampleCount: 5,
        timeout: 2000
    },
    retryCount: 3,
    retryDelay: 1000, // Fixed delay
  }),
});

// ============ Retry Helper ============

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | unknown;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      
      // Check if it's a rate limit error
      if (message.includes('429') || message.includes('rate limit') || message.includes('over rate limit')) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`[SolanaTwin] Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // For other errors, throw immediately
      throw error;
    }
  }
  
  throw lastError;
}

// ============ Core Functions ============

/**
 * Convert a Solana public key (base58) to bytes32 hex for the bridge contract
 * @param solanaPublicKey The Solana public key in base58 format
 * @returns The bytes32 hex string for the bridge contract
 */
export function solanaPublicKeyToBytes32(solanaPublicKey: string): `0x${string}` {
  try {
    // bs58 v6 has different export structure - handle both ESM and CJS
    let decode: (input: string) => Uint8Array;
    try {
      // Try ESM default export first (bs58 v6)
      const bs58Module = require('bs58');
      decode = bs58Module.default?.decode || bs58Module.decode;
      if (typeof decode !== 'function') {
        // Fallback: manual base58 decode for Solana public keys
        decode = base58Decode;
      }
    } catch {
      decode = base58Decode;
    }
    
    // Decode base58 to bytes
    const bytes = decode(solanaPublicKey);
    
    // Ensure we have exactly 32 bytes (Solana public keys are 32 bytes)
    if (bytes.length !== 32) {
      throw new Error(`Invalid Solana public key length: ${bytes.length}, expected 32`);
    }
    
    // Convert to hex string
    const hex = Array.from(bytes as Uint8Array)
      .map((byte: number) => byte.toString(16).padStart(2, '0'))
      .join('');
    
    return `0x${hex}` as `0x${string}`;
  } catch (error) {
    throw new Error(`Failed to convert Solana public key to bytes32: ${error}`);
  }
}

// Fallback base58 decoder (Bitcoin/Solana alphabet)
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Decode(input: string): Uint8Array {
  const bytes: number[] = [0];
  
  for (let j = 0; j < input.length; j++) {
    const char = input[j];
    let charValue = BASE58_ALPHABET.indexOf(char);
    if (charValue === -1) throw new Error(`Invalid base58 character: ${char}`);
    
    let carry = charValue;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  
  // Add leading zeros for each '1' at the start
  for (let i = 0; i < input.length && input[i] === '1'; i++) {
    bytes.push(0);
  }
  
  return new Uint8Array(bytes.reverse());
}

/**
 * Get the predicted Twin address for a Solana wallet
 * @param solanaPublicKey The Solana public key in base58 format
 * @returns The predicted Twin address on Base (mainnet)
 */
export async function getTwinAddress(solanaPublicKey: string): Promise<string> {
  const config = getBridgeConfig();
  
  // Convert Solana public key to bytes32
  const sender = solanaPublicKeyToBytes32(solanaPublicKey);
  
  // Call the bridge contract to get the predicted twin address with retry
  const twinAddress = await withRetry(async () => {
    return await baseClient.readContract({
      address: config.base.bridge as `0x${string}`,
      abi: BRIDGE_ABI,
      functionName: 'getPredictedTwinAddress',
      args: [sender],
    });
  });
  
  return twinAddress as string;
}

/**
 * Get full Twin address info including balances
 * @param solanaPublicKey The Solana public key
 * @returns Full Twin address info with balances
 */
export async function getTwinAddressInfo(solanaPublicKey: string): Promise<TwinAddressInfo> {
  const config = getBridgeConfig();
  const pixotchiConfig = getPixotchiSolanaConfig();
  
  // Get twin address (already has retry)
  const twinAddress = await getTwinAddress(solanaPublicKey);
  
  // Check if twin is deployed (has code)
  const code = await withRetry(async () => {
    return await baseClient.getBytecode({
      address: twinAddress as `0x${string}`,
    });
  });
  const isDeployed = !!code && code !== '0x';
  
  // Get wSOL balance
  let wsolBalance = BigInt(0);
  try {
    wsolBalance = await withRetry(async () => {
      return await baseClient.readContract({
        address: config.base.wrappedSOL as `0x${string}`,
        abi: [
          {
            name: 'balanceOf',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'account', type: 'address' }],
            outputs: [{ name: '', type: 'uint256' }],
          },
        ],
        functionName: 'balanceOf',
        args: [twinAddress as `0x${string}`],
      });
    });
  } catch {
    // Twin might not exist yet
  }
  
  // Get SEED balance
  let seedBalance = BigInt(0);
  if (pixotchiConfig.seedToken) {
    try {
      seedBalance = await withRetry(async () => {
        return await baseClient.readContract({
          address: pixotchiConfig.seedToken as `0x${string}`,
          abi: [
            {
              name: 'balanceOf',
              type: 'function',
              stateMutability: 'view',
              inputs: [{ name: 'account', type: 'address' }],
              outputs: [{ name: '', type: 'uint256' }],
            },
          ],
          functionName: 'balanceOf',
          args: [twinAddress as `0x${string}`],
        });
      });
    } catch {
      // Ignore errors
    }
  }
  
  return {
    solanaAddress: solanaPublicKey,
    twinAddress,
    isDeployed,
    wsolBalance,
    seedBalance,
  };
}

/**
 * Check if a Twin has approved the adapter for wSOL spending
 * @param twinAddress The Twin address on Base
 * @param adapterAddress The SolanaTwinAdapter address (optional, defaults to config)
 * @returns True if approved (has sufficient allowance)
 */
export async function isTwinSetup(
  twinAddress: string,
  adapterAddress?: string
): Promise<boolean> {
  const config = getBridgeConfig();
  const pixotchiConfig = getPixotchiSolanaConfig();
  
  // Use provided adapter or fall back to config
  const adapter = adapterAddress || pixotchiConfig.twinAdapter;
  
  if (!adapter) {
    console.warn('[isTwinSetup] No adapter address configured');
    return false;
  }
  
  try {
    console.log('[isTwinSetup] Checking allowance:', {
      twin: twinAddress,
      adapter,
      wsolContract: config.base.wrappedSOL,
    });
    
    const allowance = await withRetry(async () => {
      return await baseClient.readContract({
        address: config.base.wrappedSOL as `0x${string}`,
        abi: [
          {
            name: 'allowance',
            type: 'function',
            stateMutability: 'view',
            inputs: [
              { name: 'owner', type: 'address' },
              { name: 'spender', type: 'address' },
            ],
            outputs: [{ name: '', type: 'uint256' }],
          },
        ],
        functionName: 'allowance',
        args: [twinAddress as `0x${string}`, adapter as `0x${string}`],
      });
    });
    
    const threshold = BigInt(10 ** 18); // 1 wSOL
    const isSetup = allowance > threshold;
    console.log('[isTwinSetup] Result:', {
      allowance: allowance.toString(),
      threshold: threshold.toString(),
      isSetup,
    });
    
    // Consider "setup" if allowance is greater than a reasonable threshold
    return isSetup;
  } catch (error) {
    console.error('[isTwinSetup] Error checking allowance:', error);
    return false;
  }
}

/**
 * Format Twin address for display (truncated)
 */
export function formatTwinAddress(address: string, chars: number = 4): string {
  if (!address || address.length < chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Get Solana explorer URL for a transaction (mainnet)
 */
export function getSolanaExplorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}`;
}

/**
 * Get Base explorer URL for a Twin address (mainnet)
 */
export function getBaseExplorerUrl(address: string): string {
  return `https://basescan.org/address/${address}`;
}
