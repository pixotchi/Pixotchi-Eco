/**
 * RPC Cache Utilities
 * 
 * Uses React's cache() function to deduplicate RPC calls within a single request.
 * This is particularly useful for Server Components and Route Handlers that may
 * call the same contract function multiple times during rendering.
 * 
 * @example
 * // In a Server Component or Route Handler
 * import { getContractBalance, getPlantMintPrice } from '@/lib/rpc-cache';
 * 
 * async function MyComponent() {
 *   // These will only make 1 RPC call each, even if called multiple times
 *   const balance = await getContractBalance(SEED_TOKEN, userAddress);
 *   const price = await getPlantMintPrice(strainId);
 *   // Second call to same function with same args is deduped
 *   const sameBalance = await getContractBalance(SEED_TOKEN, userAddress);
 * }
 */

import { cache } from 'react';
import { createPublicClient, http, type Address, type Abi } from 'viem';
import { base } from 'viem/chains';

// Create a cached public client instance
const getPublicClient = cache(() => {
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_NODE || undefined;
    return createPublicClient({
        chain: base,
        transport: http(rpcUrl),
    });
});

/**
 * Generic cached contract read function
 * Deduplicates identical readContract calls within the same request
 */
export const cachedReadContract = cache(async <TAbi extends Abi, TFunctionName extends string>(
    address: Address,
    abi: TAbi,
    functionName: TFunctionName,
    args: readonly unknown[] = []
): Promise<unknown> => {
    const client = getPublicClient();
    return client.readContract({
        address,
        abi,
        functionName,
        args,
    } as any);
});

// Standard ABIs for common contract calls
const ERC20_ABI = [
    { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
    { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
    { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
    { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

const PIXOTCHI_ABI = [
    { name: 'getMintPriceByStrain', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }] },
    {
        name: 'getPlant', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{
            type: 'tuple', components: [
                { name: 'name', type: 'string' },
                { name: 'strain', type: 'uint8' },
                { name: 'level', type: 'uint8' },
                { name: 'xp', type: 'uint256' },
                { name: 'lastWatered', type: 'uint256' },
                { name: 'lastFed', type: 'uint256' },
            ]
        }]
    },
    { name: 'ownerOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
] as const;

/**
 * Get ERC20 token balance (cached)
 */
export const getTokenBalance = cache(async (
    tokenAddress: Address,
    walletAddress: Address
): Promise<bigint> => {
    const client = getPublicClient();
    return client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [walletAddress],
    });
});

/**
 * Get plant mint price by strain (cached)
 */
export const getPlantMintPrice = cache(async (
    pixotchiContract: Address,
    strainId: bigint
): Promise<bigint> => {
    const client = getPublicClient();
    return client.readContract({
        address: pixotchiContract,
        abi: PIXOTCHI_ABI,
        functionName: 'getMintPriceByStrain',
        args: [strainId],
    });
});

/**
 * Get plant owner (cached)
 */
export const getPlantOwner = cache(async (
    pixotchiContract: Address,
    plantId: bigint
): Promise<Address> => {
    const client = getPublicClient();
    return client.readContract({
        address: pixotchiContract,
        abi: PIXOTCHI_ABI,
        functionName: 'ownerOf',
        args: [plantId],
    });
});

/**
 * Get token symbol (cached)
 */
export const getTokenSymbol = cache(async (
    tokenAddress: Address
): Promise<string> => {
    const client = getPublicClient();
    return client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'symbol',
    });
});

/**
 * Get token decimals (cached)
 */
export const getTokenDecimals = cache(async (
    tokenAddress: Address
): Promise<number> => {
    const client = getPublicClient();
    return client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'decimals',
    });
});

/**
 * Get token info (symbol + decimals) in a single call (cached)
 */
export const getTokenInfo = cache(async (
    tokenAddress: Address
): Promise<{ symbol: string; decimals: number }> => {
    const client = getPublicClient();
    const [symbol, decimals] = await Promise.all([
        client.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'symbol',
        }),
        client.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'decimals',
        }),
    ]);
    return { symbol, decimals };
});
