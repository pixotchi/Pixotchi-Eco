'use client';

/**
 * Solana Quote Service
 * Gets wSOL -> SEED quotes directly from the SolanaTwinAdapter view contract.
 *
 * The V2 bridge contract performs the onchain swap internally, so the app no
 * longer needs external swap calldata or an external quote provider here.
 */

import { formatUnits, getAddress } from 'viem';
import { getBaseReadClient } from './base-rpc';
import {
  PIXOTCHI_SOLANA_CONFIG,
  SOLANA_TWIN_ADAPTER_ABI,
} from './solana-constants';

const DEBUG_QUOTES = false;
const MIN_WSOL_QUOTE = BigInt(100000); // 0.0001 SOL

export interface SolanaQuoteResult {
  wsolAmount: bigint;       // Amount of wSOL needed (9 decimals)
  seedAmount: bigint;       // Amount of SEED to receive (18 decimals)
  minSeedOut: bigint;       // Minimum SEED after slippage (18 decimals)
  route: string;            // Routing path description
  swapTarget: string;       // Deprecated for V2 bridge, kept for compatibility
  swapData: string;         // Deprecated for V2 bridge, kept for compatibility
  error?: string;           // Error message if quote failed
  isEstimate?: boolean;     // False for adapter quotes
}

// Default slippage for Solana bridge quotes (7% to account for cross-chain delays)
export const DEFAULT_SLIPPAGE_PERCENT = 7;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAdapterWsolForSeed(
  seedAmountNeeded: bigint,
  twinAdapterAddress: `0x${string}`,
  maxRetries = 3,
): Promise<{ wsolAmount: bigint; error?: string }> {
  let lastError: string | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delayMs = Math.min(1_000 * Math.pow(2, attempt - 1), 4_000);
        await sleep(delayMs);
      }

      const wsolAmount = (await getBaseReadClient().readContract({
        address: twinAdapterAddress,
        abi: SOLANA_TWIN_ADAPTER_ABI,
        functionName: 'getWsolForSeed',
        args: [seedAmountNeeded],
      })) as bigint;

      if (wsolAmount > BigInt(0)) {
        return { wsolAmount };
      }

      lastError = 'Twin adapter returned no quote for this SEED amount.';
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : 'Failed to fetch bridge quote';
      if (DEBUG_QUOTES) {
        console.error('[SolanaQuote] Adapter quote attempt failed:', {
          attempt: attempt + 1,
          error: lastError,
        });
      }
    }
  }

  return {
    wsolAmount: BigInt(0),
    error: lastError || 'Unable to fetch adapter quote',
  };
}

/**
 * Get quote for wSOL -> SEED swap.
 *
 * IMPORTANT:
 * - `twinAdapterAddress` should still be the SolanaTwinAdapter contract address.
 * - No external swap calldata is returned because the bridge adapter handles the
 *   swap internally on Base.
 */
export async function getWsolToSeedQuote(
  seedAmountNeeded: bigint,
  twinAdapterAddress?: string,
  slippagePercent: number = DEFAULT_SLIPPAGE_PERCENT,
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
        error: 'Invalid SEED amount',
      };
    }

    const adapterAddress = twinAdapterAddress || PIXOTCHI_SOLANA_CONFIG.twinAdapter;
    if (!adapterAddress) {
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

    const normalizedAdapter = getAddress(adapterAddress);
    const { wsolAmount, error } = await getAdapterWsolForSeed(
      seedAmountNeeded,
      normalizedAdapter,
    );

    if (wsolAmount <= BigInt(0)) {
      return {
        wsolAmount: BigInt(0),
        seedAmount: seedAmountNeeded,
        minSeedOut: BigInt(0),
        route: '',
        swapTarget: '',
        swapData: '',
        error: error || 'Failed to fetch bridge quote',
      };
    }

    const slippageMultiplier = BigInt(Math.floor((100 + slippagePercent) * 100));
    let wsolWithSlippage =
      (wsolAmount * slippageMultiplier) / BigInt(10_000);
    if (wsolWithSlippage < MIN_WSOL_QUOTE) {
      wsolWithSlippage = MIN_WSOL_QUOTE;
    }

    if (DEBUG_QUOTES) {
      console.log('[SolanaQuote] Final adapter quote:', {
        seedAmount: formatUnits(seedAmountNeeded, 18),
        wsolAmount: formatUnits(wsolWithSlippage, 9),
        adapter: normalizedAdapter,
      });
    }

    return {
      wsolAmount: wsolWithSlippage,
      seedAmount: seedAmountNeeded,
      minSeedOut: seedAmountNeeded,
      route: 'TwinAdapter getWsolForSeed',
      swapTarget: '',
      swapData: '',
      isEstimate: false,
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
      error: error instanceof Error ? error.message : 'Quote failed',
    };
  }
}

export function formatWsol(amount: bigint): string {
  return formatUnits(amount, 9);
}


export function formatSeed(amount: bigint): string {
  return formatUnits(amount, 18);
}


export function isQuoteValid(quote: SolanaQuoteResult): boolean {
  return (
    !quote.error &&
    quote.wsolAmount > BigInt(0) &&
    quote.minSeedOut > BigInt(0)
  );
}
