/**
 * ETH Quote Service
 * 
 * Fetches and caches ETH quotes for SEED amounts.
 * Uses OnchainKit's quote API with smart caching:
 * - Fetches quote for base amount (1x)
 * - Multiplies cached quote for quantity changes
 * - Refreshes quote before submission or after 30-50s
 */

import { PIXOTCHI_TOKEN_ADDRESS, WETH_ADDRESS } from "./contracts";
import type { Token } from "@coinbase/onchainkit/token";

// Token definitions
const ETH_TOKEN: Token = {
    address: "", // Empty string for native ETH
    chainId: 8453,
    decimals: 18,
    name: "ETH",
    symbol: "ETH",
    image: "https://wallet-api-production.s3.amazonaws.com/uploads/tokens/eth_288.png",
};

const SEED_TOKEN: Token = {
    address: PIXOTCHI_TOKEN_ADDRESS,
    chainId: 8453,
    decimals: 18,
    name: "SEED",
    symbol: "SEED",
    image: "/PixotchiKit/COIN.svg",
};

// Quote cache
interface CachedQuote {
    /** ETH per SEED rate (in wei per wei) */
    ethPerSeedRate: bigint;
    /** When this quote was fetched */
    fetchedAt: number;
    /** Original SEED amount the quote was for */
    baseSeedAmount: bigint;
    /** Original ETH amount quoted */
    baseEthAmount: bigint;
}

let cachedQuote: CachedQuote | null = null;
const QUOTE_CACHE_DURATION_MS = 45_000; // 45 seconds cache
const QUOTE_BUFFER_MULTIPLIER = 1.05; // 5% buffer for slippage

export interface EthQuoteResult {
    /** ETH amount in wei */
    ethAmountWei: bigint;
    /** ETH amount formatted for display */
    ethAmountFormatted: string;
    /** SEED amount this quote is for */
    seedAmountWei: bigint;
    /** Whether this quote is from cache (multiplied) */
    isFromCache: boolean;
    /** When the quote expires (timestamp ms) */
    expiresAt: number;
    /** Whether the quote is stale and should be refreshed */
    isStale: boolean;
}

/**
 * Format wei amount to human readable ETH string
 */
export function formatEthAmount(weiAmount: bigint): string {
    const ethValue = Number(weiAmount) / 1e18;

    if (ethValue < 0.0001) {
        return "< 0.0001";
    }

    if (ethValue < 0.01) {
        return ethValue.toFixed(6);
    }

    if (ethValue < 1) {
        return ethValue.toFixed(4);
    }

    return ethValue.toFixed(3);
}

/**
 * Check if the cached quote is still valid
 */
function isCacheValid(): boolean {
    if (!cachedQuote) return false;
    const age = Date.now() - cachedQuote.fetchedAt;
    return age < QUOTE_CACHE_DURATION_MS;
}

/**
 * Get cached ETH quote for a SEED amount by multiplying the base rate
 * Returns null if no valid cache exists
 */
export function getCachedEthQuote(seedAmountWei: bigint): EthQuoteResult | null {
    if (!isCacheValid() || !cachedQuote) {
        return null;
    }

    // Calculate ETH amount using the cached rate
    // ethAmount = seedAmount * (baseEthAmount / baseSeedAmount)
    const ethAmountWei = (seedAmountWei * cachedQuote.baseEthAmount) / cachedQuote.baseSeedAmount;

    // Add buffer for slippage protection
    const ethWithBuffer = (ethAmountWei * BigInt(Math.floor(QUOTE_BUFFER_MULTIPLIER * 100))) / BigInt(100);

    const age = Date.now() - cachedQuote.fetchedAt;
    const isStale = age > 30_000; // Consider stale after 30s

    return {
        ethAmountWei: ethWithBuffer,
        ethAmountFormatted: formatEthAmount(ethWithBuffer),
        seedAmountWei,
        isFromCache: true,
        expiresAt: cachedQuote.fetchedAt + QUOTE_CACHE_DURATION_MS,
        isStale,
    };
}

/**
 * Fetch a fresh ETH quote for a SEED amount from OnchainKit API
 */
export async function fetchEthQuote(seedAmountWei: bigint): Promise<EthQuoteResult> {
    try {
        // Use OnchainKit's internal API endpoint
        const response = await fetch("/api/swap/quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                from: ETH_TOKEN,
                to: SEED_TOKEN,
                amount: seedAmountWei.toString(),
                amountReference: "to", // We want to receive X SEED
            }),
        });

        if (!response.ok) {
            throw new Error(`Quote API error: ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        // Extract the quote amount (in ETH wei)
        const ethAmountWei = BigInt(data.fromAmount || data.amount || "0");

        // Add buffer for slippage protection
        const ethWithBuffer = (ethAmountWei * BigInt(Math.floor(QUOTE_BUFFER_MULTIPLIER * 100))) / BigInt(100);

        // Update cache with the new rate
        cachedQuote = {
            ethPerSeedRate: ethAmountWei * BigInt(1e18) / seedAmountWei, // Rate in 18 decimals
            fetchedAt: Date.now(),
            baseSeedAmount: seedAmountWei,
            baseEthAmount: ethAmountWei,
        };

        return {
            ethAmountWei: ethWithBuffer,
            ethAmountFormatted: formatEthAmount(ethWithBuffer),
            seedAmountWei,
            isFromCache: false,
            expiresAt: Date.now() + QUOTE_CACHE_DURATION_MS,
            isStale: false,
        };
    } catch (error) {
        console.error("[EthQuote] Failed to fetch quote:", error);

        // Try to return cached quote if available (even if stale)
        if (cachedQuote) {
            const cached = getCachedEthQuote(seedAmountWei);
            if (cached) {
                return { ...cached, isStale: true };
            }
        }

        throw error;
    }
}

/**
 * Get ETH quote for SEED amount
 * Uses cache if available and valid, otherwise fetches fresh
 * 
 * @param seedAmountWei - Amount of SEED in wei
 * @param forceRefresh - Force a fresh quote fetch
 */
export async function getEthQuote(
    seedAmountWei: bigint,
    forceRefresh = false
): Promise<EthQuoteResult> {
    // Try cache first (unless forcing refresh)
    if (!forceRefresh) {
        const cached = getCachedEthQuote(seedAmountWei);
        if (cached && !cached.isStale) {
            return cached;
        }
    }

    // Fetch fresh quote
    return fetchEthQuote(seedAmountWei);
}

/**
 * Clear the quote cache
 */
export function clearQuoteCache(): void {
    cachedQuote = null;
}

/**
 * Get the current cache state (for debugging/display)
 */
export function getQuoteCacheInfo(): { hasCache: boolean; age: number | null; isValid: boolean } {
    if (!cachedQuote) {
        return { hasCache: false, age: null, isValid: false };
    }

    const age = Date.now() - cachedQuote.fetchedAt;
    return {
        hasCache: true,
        age,
        isValid: age < QUOTE_CACHE_DURATION_MS,
    };
}
