'use client';

/**
 * Solana Quote Service
 * Gets wSOL → SEED quotes using OnchainKit Swap API
 * 
 * Uses OnchainKit's getSwapQuote for price estimation.
 * Uses OnchainKit's buildSwapTransaction for swap calldata.
 * 
 * OnchainKit uses Uniswap V3 (default) or 0x Aggregator internally.
 * 
 * IMPORTANT: The fromAddress for quotes should be the SolanaTwinAdapter address,
 * NOT the Twin address. The adapter is the contract that will execute the swap.
 */

import { parseUnits, formatUnits, getAddress } from 'viem';
import { PIXOTCHI_TOKEN_ADDRESS } from './contracts';
import { getSwapQuote, buildSwapTransaction } from '@coinbase/onchainkit/api';
import type { Token } from '@coinbase/onchainkit/token';
import { setOnchainKitConfig } from '@coinbase/onchainkit';
import { PIXOTCHI_SOLANA_CONFIG, SOLANA_BRIDGE_CONFIG } from './solana-constants';

// Debug flag - set to true for verbose logging
const DEBUG_QUOTES = false;

// Type guard to check if response is an API error
function isAPIError(response: unknown): response is { error: string; code?: string; message?: string } {
  return (
    response !== null && 
    typeof response === 'object' && 
    'error' in response
  );
}

// Token addresses on Base (from solana-constants for consistency)
const WSOL_ADDRESS = getAddress(SOLANA_BRIDGE_CONFIG.base.wrappedSOL); // Bridge wSOL on Base mainnet
const SEED_ADDRESS = getAddress(PIXOTCHI_TOKEN_ADDRESS);

// Base chain ID
const BASE_CHAIN_ID = 8453;

// Initialize OnchainKit config (API key should be set in providers.tsx, but we ensure it's set here)
if (typeof window !== 'undefined') {
  const apiKey = process.env.NEXT_PUBLIC_CDP_CLIENT_API_KEY;
  if (apiKey) {
    setOnchainKitConfig({ apiKey });
  }
}

// Token definitions for OnchainKit
const WSOL_TOKEN: Token = {
  name: 'Wrapped SOL',
  address: WSOL_ADDRESS,
  symbol: 'wSOL',
  decimals: 9,
  chainId: BASE_CHAIN_ID,
  image: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
};

const SEED_TOKEN: Token = {
  name: 'SEED',
  address: SEED_ADDRESS,
  symbol: 'SEED',
  decimals: 18,
  chainId: BASE_CHAIN_ID,
  image: '', // Add SEED token image URL if available
};

export interface SolanaQuoteResult {
  wsolAmount: bigint;       // Amount of wSOL needed (9 decimals)
  seedAmount: bigint;       // Amount of SEED to receive (18 decimals)
  minSeedOut: bigint;       // Minimum SEED after slippage (18 decimals)
  route: string;            // Routing path description
  swapTarget: string;       // Aggregator contract to call
  swapData: string;         // Encoded swap calldata for aggregator
  error?: string;           // Error message if quote failed
  isEstimate?: boolean;     // True if using estimation (no calldata)
}

// Default slippage for Solana bridge quotes (7% to account for cross-chain delays)
export const DEFAULT_SLIPPAGE_PERCENT = 7;

/**
 * Sleep helper for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if error is rate limit related
 */
function isRateLimitError(error: string | undefined): boolean {
  if (!error) return false;
  const lowerError = error.toLowerCase();
  return lowerError.includes('rate limit') || 
         lowerError.includes('too many requests') ||
         lowerError.includes('429');
}

/**
 * Get swap quote using OnchainKit API
 * Returns the amount of SEED received for a given amount of wSOL
 * Includes retry logic for rate limiting
 */
async function getOnchainKitQuote(
  wsolAmount: bigint,
  maxRetries: number = 3
): Promise<{ seedAmount: bigint; error?: string }> {
  let lastError: string | undefined;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Add delay between retries (exponential backoff)
      if (attempt > 0) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
        if (DEBUG_QUOTES) console.log(`[OnchainKit] Quote retry ${attempt + 1}/${maxRetries} after ${delayMs}ms`);
        await sleep(delayMs);
      }
      
      const wsolAmountStr = formatUnits(wsolAmount, 9);
      if (DEBUG_QUOTES) {
        console.log('[OnchainKit] Requesting quote:', {
          from: WSOL_TOKEN.symbol,
          to: SEED_TOKEN.symbol,
          amount: wsolAmountStr,
          useAggregator: true,
          attempt: attempt + 1,
        });
      }
      
      const quote = await getSwapQuote({
        from: WSOL_TOKEN,
        to: SEED_TOKEN,
        amount: wsolAmountStr,
        useAggregator: true, // Use aggregator (0x) for better rates
      });

      if (DEBUG_QUOTES) {
        console.log('[OnchainKit] Quote response received:', {
          isAPIError: isAPIError(quote),
          hasToAmount: 'toAmount' in quote,
          toAmount: 'toAmount' in quote ? quote.toAmount : undefined,
          error: isAPIError(quote) ? quote.error : undefined,
        });
      }

      if (isAPIError(quote)) {
        lastError = quote.error || 'Failed to get quote from OnchainKit';
        if (DEBUG_QUOTES) console.error('[OnchainKit] API returned error:', lastError);
        
        // If rate limited, retry
        if (isRateLimitError(lastError) && attempt < maxRetries - 1) {
          if (DEBUG_QUOTES) console.warn(`[OnchainKit] Rate limited, will retry...`);
          continue;
        }
        
        return { 
          seedAmount: BigInt(0), 
          error: lastError
        };
      }

      // TypeScript now knows quote is SwapQuoteParams
      if (!('toAmount' in quote) || !quote.toAmount) {
        if (DEBUG_QUOTES) console.error('[OnchainKit] Invalid quote response - missing toAmount');
        return { seedAmount: BigInt(0), error: 'Invalid quote response from OnchainKit: missing toAmount' };
      }

      const seedAmount = BigInt(quote.toAmount);
      if (DEBUG_QUOTES) {
        console.log('[OnchainKit] Quote successful:', {
          wsolAmount: wsolAmountStr,
          seedAmount: formatUnits(seedAmount, 18),
        });
      }

      return { seedAmount };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown connection error';
      if (DEBUG_QUOTES) {
        console.error(`[OnchainKit] Quote API exception (attempt ${attempt + 1}):`, {
          error: lastError,
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
      
      // If rate limited, retry
      if (isRateLimitError(lastError) && attempt < maxRetries - 1) {
        continue;
      }
    }
  }
  
  return { 
    seedAmount: BigInt(0), 
    error: lastError || 'Max retries exceeded'
  };
}

/**
 * Build swap transaction using OnchainKit API
 * Returns swap calldata and expected output amount
 * Includes retry logic for rate limiting
 */
async function getOnchainKitSwapTransaction(
  wsolAmount: bigint,
  fromAddress: string,
  slippage: number = 7,
  maxRetries: number = 3
): Promise<{
  toAmount: bigint;
  tx?: {
    to: `0x${string}`;
    data: `0x${string}`;
  };
  error?: string;
} | null> {
  let lastError: string | undefined;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Add delay between retries (exponential backoff)
      if (attempt > 0) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
        if (DEBUG_QUOTES) console.log(`[OnchainKit] Retry attempt ${attempt + 1}/${maxRetries} after ${delayMs}ms delay`);
        await sleep(delayMs);
      }
      
      // Ensure fromAddress is a valid checksummed address
      const validAddress = getAddress(fromAddress);
      
      const transactionResponse = await buildSwapTransaction({
        from: WSOL_TOKEN,
        to: SEED_TOKEN,
        amount: formatUnits(wsolAmount, 9), // Convert to decimal string
        fromAddress: validAddress,
        maxSlippage: slippage.toString(),
        useAggregator: true, // Use aggregator (0x) for better rates
      });

      // Check for API error
      if (isAPIError(transactionResponse)) {
        lastError = transactionResponse.error || 'Failed to build swap transaction';
        
        // If rate limited, retry
        if (isRateLimitError(lastError) && attempt < maxRetries - 1) {
          console.warn(`[OnchainKit] Rate limited, will retry: ${lastError}`);
          continue;
        }
        
        return { 
          toAmount: BigInt(0), 
          error: lastError
        };
      }

      // TypeScript now knows transactionResponse is BuildSwapTransaction
      const transaction = transactionResponse.transaction;
      const quote = transactionResponse.quote;

      if (!transaction || !transaction.to || !transaction.data) {
        return { 
          toAmount: BigInt(0), 
          error: 'Invalid transaction response from OnchainKit' 
        };
      }
      
      const expectedOutput = quote?.toAmount ? BigInt(quote.toAmount) : BigInt(0);
      
      return {
        toAmount: expectedOutput,
        tx: {
          to: transaction.to as `0x${string}`,
          data: transaction.data as `0x${string}`,
        },
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'API connection error';
      console.error(`[OnchainKit] Swap transaction API error (attempt ${attempt + 1}):`, error);
      
      // If rate limited, retry
      if (isRateLimitError(lastError) && attempt < maxRetries - 1) {
        continue;
      }
    }
  }
  
  return { 
    toAmount: BigInt(0), 
    error: lastError || 'Max retries exceeded'
  };
}

/**
 * Get quote for wSOL → SEED swap
 * Uses OnchainKit API for BOTH rate estimation and execution data
 * 
 * IMPORTANT: The fromAddress should be the SolanaTwinAdapter address, NOT the Twin address.
 * The adapter contract is the one that will execute the swap with the wSOL it receives.
 * 
 * @param seedAmountNeeded - Amount of SEED needed (18 decimals)
 * @param twinAdapterAddress - The SolanaTwinAdapter contract address (REQUIRED)
 * @param slippagePercent - Slippage tolerance (default 7% for cross-chain)
 * @returns Quote with wsolAmount needed and swap calldata
 */
export async function getWsolToSeedQuote(
  seedAmountNeeded: bigint,
  twinAdapterAddress?: string,
  slippagePercent: number = DEFAULT_SLIPPAGE_PERCENT
): Promise<SolanaQuoteResult> {
  try {
    if (seedAmountNeeded <= BigInt(0)) {
      return { 
        wsolAmount: BigInt(0), 
        seedAmount: BigInt(0), 
        minSeedOut: BigInt(0),
        route: '',
        swapTarget: '',
        swapData: '',
        error: 'Invalid SEED amount' 
      };
    }
    
    // CRITICAL: We need the TwinAdapter address for swap calldata
    // The TwinAdapter is the contract that executes the swap, so the quote must be built for it
    const fromAddress = twinAdapterAddress || PIXOTCHI_SOLANA_CONFIG.twinAdapter;
    
    if (!fromAddress) {
      console.error('[SolanaQuote] No TwinAdapter address configured');
      return {
        wsolAmount: BigInt(0),
        seedAmount: seedAmountNeeded,
        minSeedOut: BigInt(0),
        route: '',
        swapTarget: '',
        swapData: '',
        error: 'SolanaTwinAdapter address not configured. Set NEXT_PUBLIC_SOLANA_TWIN_ADAPTER.',
      };
    }

    if (DEBUG_QUOTES) {
      console.log('[SolanaQuote] Getting quote for', formatUnits(seedAmountNeeded, 18), 'SEED');
      console.log('[SolanaQuote] TwinAdapter address:', fromAddress);
    }
    
    // Step 1: Get initial rate estimate from OnchainKit
    // We ask: How much SEED for 1 wSOL?
    const ONE_WSOL = BigInt(1000000000); // 1e9
    if (DEBUG_QUOTES) console.log('[SolanaQuote] Fetching initial rate estimate from OnchainKit...');
    const { seedAmount: seedForOneWsol, error: rateError } = await getOnchainKitQuote(ONE_WSOL);
    
    if (!seedForOneWsol || seedForOneWsol === BigInt(0)) {
      const errorMsg = rateError || 'Failed to fetch price from OnchainKit API';
      if (DEBUG_QUOTES) {
        console.error('[SolanaQuote] Initial rate estimate failed:', {
          error: errorMsg,
          seedForOneWsol: seedForOneWsol?.toString() || '0',
        });
      }
      return {
        wsolAmount: BigInt(0),
        seedAmount: seedAmountNeeded,
        minSeedOut: BigInt(0),
        route: '',
        swapTarget: '',
        swapData: '',
        error: errorMsg,
      };
    }
    
    if (DEBUG_QUOTES) {
      console.log('[SolanaQuote] Initial rate estimate successful:', {
        seedForOneWsol: formatUnits(seedForOneWsol, 18),
      });
    }
    
    // Calculate wSOL needed: 
    // rate = seedForOneWsol / 1e9
    // wsolNeeded = seedAmountNeeded / rate
    // wsolNeeded = (seedAmountNeeded * 1e9) / seedForOneWsol
    
    const estimatedWsol = (seedAmountNeeded * ONE_WSOL) / seedForOneWsol;
    
    // Adding 1% buffer to the estimate to ensure we ask OnchainKit for enough
    let wsolAmount = (estimatedWsol * BigInt(101)) / BigInt(100); 
    
    // Minimum amount check (0.0001 SOL)
    const minWsol = BigInt(100000); 
    if (wsolAmount < minWsol) wsolAmount = minWsol;

    if (DEBUG_QUOTES) {
      console.log('[SolanaQuote] API Estimate:', {
          seedPerWsol: formatUnits(seedForOneWsol, 18),
          wsolEstimated: formatUnits(wsolAmount, 9)
      });
    }

    let route = 'OnchainKit Aggregator';
    let swapTarget = '';
    let swapData = '';
    let isEstimate = true;
    
    // Step 2: Get OnchainKit Swap Transaction Data
    // Use the TwinAdapter address as the fromAddress since it will execute the swap
    const swapResult = await getOnchainKitSwapTransaction(
      wsolAmount,
      fromAddress,
      slippagePercent
    );
    
    if (swapResult && !swapResult.error) {
      const expectedSeed = swapResult.toAmount;
      
      // If OnchainKit quote gives us enough SEED, use it
      if (expectedSeed >= seedAmountNeeded) {
        isEstimate = false;
        
        if (swapResult.tx) {
          swapTarget = swapResult.tx.to;
          swapData = swapResult.tx.data;
        } else {
           return {
              wsolAmount: BigInt(0),
              seedAmount: seedAmountNeeded,
              minSeedOut: BigInt(0),
              route: '',
              swapTarget: '',
              swapData: '',
              error: 'OnchainKit API returned no transaction data',
           };
        }
      } else {
        // Need more wSOL - increase estimate based on the shortfall
        const deficit = seedAmountNeeded - expectedSeed;
        const deficitRatio = (deficit * BigInt(100)) / seedAmountNeeded;
        // Add deficit + small buffer
        const extraBuffer = BigInt(1) + (deficitRatio / BigInt(5)); // 20% of deficit as extra buffer
        wsolAmount = (wsolAmount * (BigInt(100) + deficitRatio + extraBuffer)) / BigInt(100);
        
        if (DEBUG_QUOTES) console.log('[SolanaQuote] Retrying with higher amount:', formatUnits(wsolAmount, 9));

        // Try again with higher amount
        const retryResult = await getOnchainKitSwapTransaction(
          wsolAmount,
          fromAddress,
          slippagePercent
        );
        
        if (retryResult?.tx && retryResult.toAmount >= seedAmountNeeded) {
          swapTarget = retryResult.tx.to;
          swapData = retryResult.tx.data;
          isEstimate = false;
        } else {
           return {
              wsolAmount: BigInt(0),
              seedAmount: seedAmountNeeded,
              minSeedOut: BigInt(0),
              route: '',
              swapTarget: '',
              swapData: '',
              error: retryResult?.error || 'Insufficient liquidity or slippage too high',
           };
        }
      }
    } else {
       return {
          wsolAmount: BigInt(0),
          seedAmount: seedAmountNeeded,
          minSeedOut: BigInt(0),
          route: '',
          swapTarget: '',
          swapData: '',
          error: swapResult?.error || 'OnchainKit API failed to quote',
       };
    }
    
    // Add slippage buffer to wSOL input for cross-chain safety
    // The slippage is handled in the swap params (minAmountOut),
    // but having slightly more wSOL helps if price moves between quote and execution.
    // If we send MORE wSOL than the calldata expects, the leftover is refunded by the adapter.
    
    const slippageMultiplier = BigInt(Math.floor((100 + slippagePercent) * 100));
    const wsolWithSlippage = (wsolAmount * slippageMultiplier) / BigInt(10000);
    
    if (DEBUG_QUOTES) {
      console.log('[SolanaQuote] Final Quote:', {
        wsolAmount: formatUnits(wsolWithSlippage, 9),
        seedAmount: formatUnits(seedAmountNeeded, 18),
        route,
        hasSwapData: !!swapData,
      });
    }
    
    return {
      wsolAmount: wsolWithSlippage,
      seedAmount: seedAmountNeeded,
      minSeedOut: seedAmountNeeded,
      route,
      swapTarget,
      swapData,
      isEstimate,
    };
    
  } catch (error) {
    console.error('[SolanaQuote] Quote failed:', error);
    return {
      wsolAmount: BigInt(0),
      seedAmount: BigInt(0),
      minSeedOut: BigInt(0),
      route: '',
      swapTarget: '',
      swapData: '',
      error: error instanceof Error ? error.message : 'Quote failed'
    };
  }
}

// ============ Formatting Helpers ============

export function formatWsol(amount: bigint): string {
  return formatUnits(amount, 9);
}

export const formatSol = formatWsol;

export function formatSeed(amount: bigint): string {
  return formatUnits(amount, 18);
}

export function parseWsol(amount: string): bigint {
  return parseUnits(amount, 9);
}

export function parseSeed(amount: string): bigint {
  return parseUnits(amount, 18);
}

// ============ High-Level Quote Functions ============

export async function getSolanaBridgeQuote(params: {
  action: 'mint' | 'shopItem' | 'gardenItem' | 'setName';
  seedPriceNeeded: bigint;
  twinAdapterAddress?: string;
  slippagePercent?: number;
}): Promise<SolanaQuoteResult & { 
  displayWsol: string;
  displaySeed: string;
}> {
  const { seedPriceNeeded, twinAdapterAddress, slippagePercent = DEFAULT_SLIPPAGE_PERCENT } = params;
  
  const quote = await getWsolToSeedQuote(seedPriceNeeded, twinAdapterAddress, slippagePercent);
  
  return {
    ...quote,
    displayWsol: formatWsol(quote.wsolAmount),
    displaySeed: formatSeed(quote.seedAmount),
  };
}

export function isQuoteStale(quoteTimestamp: number, maxAgeMs: number = 30000): boolean {
  return Date.now() - quoteTimestamp > maxAgeMs;
}

export function isQuoteValid(quote: SolanaQuoteResult): boolean {
  return !quote.error && quote.wsolAmount > BigInt(0) && quote.minSeedOut > BigInt(0);
}
