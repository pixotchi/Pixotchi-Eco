'use client';

/**
 * Solana Bridge Hook
 * Handles building and executing bridge transactions
 * 
 * Quote flow:
 * 1. Read SEED price from contract (via adapter view functions)
 * 2. Get wSOL estimate from 1inch Oracle
 * 3. Get exact quote and calldata from 1inch API
 * 4. Build transaction with wsolAmount + minSeedOut
 */

// Debug flag - set to true for verbose logging
const DEBUG_BRIDGE = false;

import { useCallback, useState } from 'react';
import { useSolanaWallet } from './useSolanaWallet';
import {
  buildSetupTransaction,
  buildMintTransaction,
  buildShopItemTransaction,
  buildGardenItemTransaction,
  buildBoxGameTransaction,
  buildSpinGameTransaction,
  buildAttackTransaction,
  buildClaimRewardsTransaction,
  buildSetNameTransaction,
  type BridgeTransaction,
  type BridgeActionType,
} from '@/lib/solana-bridge-service';
import {
  getWsolToSeedQuote,
  formatWsol,
  formatSeed,
  isQuoteValid,
  type SolanaQuoteResult,
} from '@/lib/solana-quote';
import { BRIDGE_CONFIG, SOLANA_TWIN_ADAPTER_ABI, getPixotchiSolanaConfig } from '@/lib/solana-constants';
import { getReadClient } from '@/lib/contracts';
import { getAddress } from 'viem';
import { executeBridgeTransaction, checkSolBalance, getSolanaExplorerTxUrl } from '@/lib/solana-bridge-executor';
import type { Transaction } from '@solana/web3.js';

// ============ Types ============

export type BridgeStatus = 
  | 'idle'
  | 'building'
  | 'quoting'
  | 'ready'
  | 'signing'
  | 'bridging'
  | 'confirming'
  | 'success'
  | 'error';

export interface BridgeState {
  status: BridgeStatus;
  transaction: BridgeTransaction | null;
  quote: SolanaQuoteResult | null;
  signature: string | null;
  error: string | null;
}

export interface SolanaBridgeHook {
  /** Current bridge state */
  state: BridgeState;
  /** Whether user needs to setup first */
  needsSetup: boolean;
  /** Build and prepare a setup transaction */
  prepareSetup: () => Promise<BridgeTransaction | null>;
  /** Build and prepare a mint transaction */
  prepareMint: (strain: number) => Promise<BridgeTransaction | null>;
  /** Build and prepare a shop item purchase */
  prepareShopItem: (plantId: number, itemId: number) => Promise<BridgeTransaction | null>;
  /** Build and prepare a garden item purchase */
  prepareGardenItem: (plantId: number, itemId: number) => Promise<BridgeTransaction | null>;
  /** Build and prepare box game */
  prepareBoxGame: (plantId: number) => Promise<BridgeTransaction | null>;
  /** Build and prepare spin game */
  prepareSpinGame: (plantId: number) => Promise<BridgeTransaction | null>;
  /** Build and prepare attack */
  prepareAttack: (fromId: number, toId: number) => Promise<BridgeTransaction | null>;
  /** Build and prepare rewards claim */
  prepareClaimRewards: (plantId: number) => Promise<BridgeTransaction | null>;
  /** Build and prepare name change */
  prepareSetName: (plantId: number, name: string) => Promise<BridgeTransaction | null>;
  /** Execute the prepared transaction (requires Solana wallet signature) */
  execute: (signTransaction: (tx: Transaction) => Promise<Transaction>) => Promise<string | null>;
  /** Reset state */
  reset: () => void;
  /** Get quote for an action */
  getQuote: (actionType: BridgeActionType, params?: Record<string, unknown>) => Promise<SolanaQuoteResult | null>;
}

// ============ Price Fetching Helpers ============

// ABI for getting mint price directly from Pixotchi contract
const GET_ALL_STRAIN_INFO_ABI = [{
  inputs: [],
  name: 'getAllStrainInfo',
  outputs: [{ name: '', type: 'tuple[]', components: [
    { name: 'id', type: 'uint256' },
    { name: 'mintPrice', type: 'uint256' },
    { name: 'totalSupply', type: 'uint256' },
    { name: 'totalMinted', type: 'uint256' },
    { name: 'maxSupply', type: 'uint256' },
    { name: 'name', type: 'string' },
    { name: 'isActive', type: 'bool' },
  ]}],
  stateMutability: 'view',
  type: 'function',
}] as const;

async function getMintPriceInSeed(strain: number): Promise<bigint> {
  const config = getPixotchiSolanaConfig();
  const readClient = getReadClient();
  
  // Try to get price from twin adapter if configured
  if (config.twinAdapter) {
    try {
      const price = await readClient.readContract({
        address: getAddress(config.twinAdapter),
        abi: SOLANA_TWIN_ADAPTER_ABI,
        functionName: 'getMintPriceInSeed',
        args: [BigInt(strain)],
      }) as bigint;
      return price;
    } catch (err) {
      console.warn('[SolanaBridge] Failed to get price from adapter, using fallback:', err);
    }
  }
  
  // Fallback: Get price directly from Pixotchi contract
  const PIXOTCHI_NFT = getAddress('0xeb4e16c804AE9275a655AbBc20cD0658A91F9235');
  const strains = await readClient.readContract({
    address: PIXOTCHI_NFT,
    abi: GET_ALL_STRAIN_INFO_ABI,
    functionName: 'getAllStrainInfo',
  }) as Array<{ id: bigint; mintPrice: bigint; name: string }>;
  
  const strainData = strains.find(s => Number(s.id) === strain);
  if (!strainData) {
    throw new Error(`Strain ${strain} not found`);
  }
  
  if (DEBUG_BRIDGE) console.log('[SolanaBridge] Got mint price from fallback:', Number(strainData.mintPrice) / 1e18, 'SEED');
  return strainData.mintPrice;
}

async function getShopItemPriceInSeed(itemId: number): Promise<bigint> {
  const config = getPixotchiSolanaConfig();
  if (!config.twinAdapter) throw new Error('Twin adapter not configured');
  
  const readClient = getReadClient();
  const price = await readClient.readContract({
    address: getAddress(config.twinAdapter),
    abi: SOLANA_TWIN_ADAPTER_ABI,
    functionName: 'getShopItemPriceInSeed',
    args: [BigInt(itemId)],
  }) as bigint;
  
  return price;
}

async function getGardenItemPriceInSeed(itemId: number): Promise<bigint> {
  const config = getPixotchiSolanaConfig();
  if (!config.twinAdapter) throw new Error('Twin adapter not configured');
  
  const readClient = getReadClient();
  const price = await readClient.readContract({
    address: getAddress(config.twinAdapter),
    abi: SOLANA_TWIN_ADAPTER_ABI,
    functionName: 'getGardenItemPriceInSeed',
    args: [BigInt(itemId)],
  }) as bigint;
  
  return price;
}

async function getNameChangePriceInSeed(): Promise<bigint> {
  const config = getPixotchiSolanaConfig();
  if (!config.twinAdapter) throw new Error('Twin adapter not configured');
  
  const readClient = getReadClient();
  const price = await readClient.readContract({
    address: getAddress(config.twinAdapter),
    abi: SOLANA_TWIN_ADAPTER_ABI,
    functionName: 'getNameChangePriceInSeed',
    args: [],
  }) as bigint;
  
  return price;
}

// ============ Quote Helpers ============

// Default slippage from config (7% for cross-chain transactions)
const DEFAULT_SLIPPAGE = BRIDGE_CONFIG.defaultSlippagePercent;

// Get the twin adapter address for quotes (needed for 1inch swap data)
function getTwinAdapterAddress(): string | undefined {
  try {
    const config = getPixotchiSolanaConfig();
    return config.twinAdapter;
  } catch {
    return undefined;
  }
}

async function quoteMintCost(strain: number, slippage: number = DEFAULT_SLIPPAGE): Promise<SolanaQuoteResult> {
  const seedPrice = await getMintPriceInSeed(strain);
  const adapterAddress = getTwinAdapterAddress();
  
  if (DEBUG_BRIDGE) {
    console.log('[SolanaBridge] quoteMintCost:', {
      strain,
      seedPrice: seedPrice.toString(),
      adapterAddress: adapterAddress || 'MISSING',
    });
  }
  
  if (!adapterAddress) {
    return {
      wsolAmount: BigInt(0),
      seedAmount: seedPrice,
      minSeedOut: BigInt(0),
      route: '',
      swapTarget: '',
      swapData: '',
      error: 'Twin adapter address not configured. Please check your Solana bridge configuration.',
    };
  }
  
  return getWsolToSeedQuote(seedPrice, adapterAddress, slippage);
}

async function quoteShopItemCost(itemId: number, slippage: number = DEFAULT_SLIPPAGE): Promise<SolanaQuoteResult> {
  const seedPrice = await getShopItemPriceInSeed(itemId);
  const adapterAddress = getTwinAdapterAddress();
  return getWsolToSeedQuote(seedPrice, adapterAddress, slippage);
}

async function quoteGardenItemCost(itemId: number, slippage: number = DEFAULT_SLIPPAGE): Promise<SolanaQuoteResult> {
  const seedPrice = await getGardenItemPriceInSeed(itemId);
  const adapterAddress = getTwinAdapterAddress();
  return getWsolToSeedQuote(seedPrice, adapterAddress, slippage);
}

async function quoteNameChangeCost(slippage: number = DEFAULT_SLIPPAGE): Promise<SolanaQuoteResult> {
  const seedPrice = await getNameChangePriceInSeed();
  if (seedPrice === BigInt(0)) {
    // Free name change
    return {
      wsolAmount: BigInt(0),
      seedAmount: BigInt(0),
      minSeedOut: BigInt(0),
      route: 'Free',
      swapTarget: '',
      swapData: '',
    };
  }
  const adapterAddress = getTwinAdapterAddress();
  return getWsolToSeedQuote(seedPrice, adapterAddress, slippage);
}

// ============ Hook ============

export function useSolanaBridge(): SolanaBridgeHook {
  const { solanaAddress, isTwinSetup, isConnected } = useSolanaWallet();
  
  const [state, setState] = useState<BridgeState>({
    status: 'idle',
    transaction: null,
    quote: null,
    signature: null,
    error: null,
  });
  
  const needsSetup = isConnected && !isTwinSetup;
  
  // Helper to update state
  const updateState = useCallback((updates: Partial<BridgeState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);
  
  // Reset state
  const reset = useCallback(() => {
    setState({
      status: 'idle',
      transaction: null,
      quote: null,
      signature: null,
      error: null,
    });
  }, []);
  
  // Get quote for action
  const getQuote = useCallback(async (
    actionType: BridgeActionType,
    params?: Record<string, unknown>
  ): Promise<SolanaQuoteResult | null> => {
    try {
      updateState({ status: 'quoting', error: null });
      
      let quote: SolanaQuoteResult | null = null;
      
      switch (actionType) {
        case 'mint':
          quote = await quoteMintCost(params?.strain as number ?? 0);
          break;
        case 'shopItem':
          quote = await quoteShopItemCost(params?.itemId as number ?? 0);
          break;
        case 'gardenItem':
          quote = await quoteGardenItemCost(params?.itemId as number ?? 0);
          break;
        case 'setName':
          quote = await quoteNameChangeCost();
          break;
        default:
          // Actions without SEED cost return minimal quote for gas
          quote = {
            wsolAmount: BRIDGE_CONFIG.minBridgeAmount,
            seedAmount: BigInt(0),
            minSeedOut: BigInt(0),
            route: 'Gas only',
            swapTarget: '',
            swapData: '',
          };
      }
      
      // Update state with the quote so prepareMint can reuse it
      if (quote) {
        updateState({ 
          quote, 
          status: quote.error ? 'error' : 'idle', 
          error: quote.error || null 
        });
        if (DEBUG_BRIDGE) {
          console.log('[SolanaBridge] getQuote stored in state (V2):', {
            hasQuote: true,
            wsolAmount: quote.wsolAmount?.toString(),
            error: quote.error,
          });
        }
      } else {
        updateState({ status: 'error', error: 'Failed to get quote' });
      }
      
      return quote;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to get quote';
      console.error('[SolanaBridge] getQuote error:', error);
      updateState({ status: 'error', error: errorMsg });
      return null;
    }
  }, [updateState]);
  
  // Prepare setup transaction
  const prepareSetup = useCallback(async (): Promise<BridgeTransaction | null> => {
    if (!solanaAddress) {
      updateState({ error: 'No Solana wallet connected' });
      return null;
    }
    
    updateState({ status: 'building', error: null });
    
    try {
      const tx = await buildSetupTransaction(solanaAddress);
      updateState({ status: 'ready', transaction: tx });
      return tx;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to build setup transaction';
      updateState({ status: 'error', error: message });
      return null;
    }
  }, [solanaAddress, updateState]);
  
  // Prepare mint transaction
  const prepareMint = useCallback(async (strain: number): Promise<BridgeTransaction | null> => {
    if (!solanaAddress) {
      const errorMsg = 'No Solana wallet connected';
      updateState({ status: 'error', error: errorMsg });
      return null;
    }
    
    if (needsSetup) {
      const errorMsg = 'Please setup bridge access first';
      updateState({ status: 'error', error: errorMsg });
      return null;
    }
    
    // Check if we already have a valid quote in state
    // V2: No swap data needed - contract does on-chain swaps
    const existingQuote = state.quote;
    const hasValidExistingQuote = existingQuote && isQuoteValid(existingQuote);
    
    if (!hasValidExistingQuote) {
      updateState({ status: 'quoting', error: null });
    } else {
      if (DEBUG_BRIDGE) console.log('[SolanaBridge] Using existing quote from state');
      updateState({ status: 'building', error: null });
    }
    
    try {
      if (DEBUG_BRIDGE) {
        console.log('[SolanaBridge] prepareMint starting (V2 - on-chain swap):', {
          strain,
          solanaAddress,
          needsSetup,
          hasExistingQuote: hasValidExistingQuote,
        });
      }
      
      // Use existing quote if valid, otherwise fetch new one
      let quote: SolanaQuoteResult;
      if (hasValidExistingQuote) {
        quote = existingQuote;
        if (DEBUG_BRIDGE) {
          console.log('[SolanaBridge] Reusing existing quote:', {
            wsolAmount: quote.wsolAmount?.toString(),
          });
        }
      } else {
        quote = await quoteMintCost(strain);
        if (DEBUG_BRIDGE) {
          console.log('[SolanaBridge] Quote received in prepareMint:', {
            hasError: !!quote.error,
            wsolAmount: quote.wsolAmount?.toString(),
            seedAmount: quote.seedAmount?.toString(),
            minSeedOut: quote.minSeedOut?.toString(),
            route: quote.route,
          });
        }
      }
      
      if (!isQuoteValid(quote)) {
        const errorMsg = quote.error || 'Failed to get valid quote';
        if (DEBUG_BRIDGE) {
          console.error('[SolanaBridge] Quote validation failed:', {
            error: errorMsg,
            wsolAmount: quote.wsolAmount?.toString(),
            minSeedOut: quote.minSeedOut?.toString(),
            hasError: !!quote.error,
          });
        }
        updateState({ status: 'error', error: errorMsg });
        return null;
      }
      
      // V2: No swap data validation needed - contract does on-chain swaps
      
      // Update state with quote before building transaction
      updateState({ quote, status: 'building', error: null });
      
      if (DEBUG_BRIDGE) console.log('[SolanaBridge] Building mint transaction...');
      const tx = await buildMintTransaction(solanaAddress, strain, quote);
      if (DEBUG_BRIDGE) console.log('[SolanaBridge] Mint transaction built successfully');
      updateState({ status: 'ready', transaction: tx, error: null });
      return tx;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error) || 'Failed to build mint transaction';
      if (DEBUG_BRIDGE) {
        console.error('[SolanaBridge] prepareMint error:', {
          error: message,
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          errorStack: error instanceof Error ? error.stack : undefined,
          errorString: String(error),
        });
      }
      updateState({ status: 'error', error: message });
      return null;
    }
  }, [solanaAddress, needsSetup, updateState, state.quote]);
  
  // Prepare shop item transaction
  const prepareShopItem = useCallback(async (
    plantId: number,
    itemId: number
  ): Promise<BridgeTransaction | null> => {
    if (!solanaAddress) {
      updateState({ error: 'No Solana wallet connected' });
      return null;
    }
    
    if (needsSetup) {
      updateState({ error: 'Please setup bridge access first' });
      return null;
    }
    
    // Reuse existing valid quote if present; otherwise fetch a fresh one
    const existingQuote = state.quote;
    const hasValidExistingQuote = existingQuote && isQuoteValid(existingQuote);

    updateState({ status: hasValidExistingQuote ? 'building' : 'quoting', error: null });
    
    try {
      const quote = hasValidExistingQuote ? existingQuote! : await quoteShopItemCost(itemId);
      
      if (!isQuoteValid(quote)) {
        throw new Error(quote.error || 'Failed to get quote from BaseSwap');
      }
      
      updateState({ quote, status: 'building' });
      
      const tx = await buildShopItemTransaction(solanaAddress, plantId, itemId, quote);
      updateState({ status: 'ready', transaction: tx });
      return tx;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to build shop transaction';
      updateState({ status: 'error', error: message });
      return null;
    }
  }, [solanaAddress, needsSetup, updateState, state.quote]);
  
  // Prepare garden item transaction
  const prepareGardenItem = useCallback(async (
    plantId: number,
    itemId: number
  ): Promise<BridgeTransaction | null> => {
    if (!solanaAddress) {
      updateState({ error: 'No Solana wallet connected' });
      return null;
    }
    
    if (needsSetup) {
      updateState({ error: 'Please setup bridge access first' });
      return null;
    }
    
    // Reuse existing valid quote if present; otherwise fetch a fresh one
    const existingQuote = state.quote;
    const hasValidExistingQuote = existingQuote && isQuoteValid(existingQuote);

    updateState({ status: hasValidExistingQuote ? 'building' : 'quoting', error: null });
    
    try {
      const quote = hasValidExistingQuote ? existingQuote! : await quoteGardenItemCost(itemId);
      
      if (!isQuoteValid(quote)) {
        throw new Error(quote.error || 'Failed to get quote from BaseSwap');
      }
      
      updateState({ quote, status: 'building' });
      
      const tx = await buildGardenItemTransaction(solanaAddress, plantId, itemId, quote);
      updateState({ status: 'ready', transaction: tx });
      return tx;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to build garden transaction';
      updateState({ status: 'error', error: message });
      return null;
    }
  }, [solanaAddress, needsSetup, updateState, state.quote]);
  
  // Prepare box game transaction
  const prepareBoxGame = useCallback(async (plantId: number): Promise<BridgeTransaction | null> => {
    if (!solanaAddress) {
      updateState({ error: 'No Solana wallet connected' });
      return null;
    }
    
    updateState({ status: 'building', error: null });
    
    try {
      const tx = await buildBoxGameTransaction(solanaAddress, plantId);
      updateState({ status: 'ready', transaction: tx });
      return tx;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to build game transaction';
      updateState({ status: 'error', error: message });
      return null;
    }
  }, [solanaAddress, updateState]);
  
  // Prepare spin game transaction
  const prepareSpinGame = useCallback(async (plantId: number): Promise<BridgeTransaction | null> => {
    if (!solanaAddress) {
      updateState({ error: 'No Solana wallet connected' });
      return null;
    }
    
    updateState({ status: 'building', error: null });
    
    try {
      const tx = await buildSpinGameTransaction(solanaAddress, plantId);
      updateState({ status: 'ready', transaction: tx });
      return tx;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to build game transaction';
      updateState({ status: 'error', error: message });
      return null;
    }
  }, [solanaAddress, updateState]);
  
  // Prepare attack transaction
  const prepareAttack = useCallback(async (
    fromId: number,
    toId: number
  ): Promise<BridgeTransaction | null> => {
    if (!solanaAddress) {
      updateState({ error: 'No Solana wallet connected' });
      return null;
    }
    
    updateState({ status: 'building', error: null });
    
    try {
      const tx = await buildAttackTransaction(solanaAddress, fromId, toId);
      updateState({ status: 'ready', transaction: tx });
      return tx;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to build attack transaction';
      updateState({ status: 'error', error: message });
      return null;
    }
  }, [solanaAddress, updateState]);
  
  // Prepare claim rewards transaction
  const prepareClaimRewards = useCallback(async (plantId: number): Promise<BridgeTransaction | null> => {
    if (!solanaAddress) {
      updateState({ error: 'No Solana wallet connected' });
      return null;
    }
    
    updateState({ status: 'building', error: null });
    
    try {
      const tx = await buildClaimRewardsTransaction(solanaAddress, plantId);
      updateState({ status: 'ready', transaction: tx });
      return tx;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to build rewards transaction';
      updateState({ status: 'error', error: message });
      return null;
    }
  }, [solanaAddress, updateState]);
  
  // Prepare set name transaction
  const prepareSetName = useCallback(async (
    plantId: number,
    name: string
  ): Promise<BridgeTransaction | null> => {
    if (!solanaAddress) {
      updateState({ error: 'No Solana wallet connected' });
      return null;
    }
    
    if (needsSetup) {
      updateState({ error: 'Please setup bridge access first' });
      return null;
    }
    
    // Reuse existing valid quote if present; otherwise fetch a fresh one
    const existingQuote = state.quote;
    const hasValidExistingQuote = existingQuote && isQuoteValid(existingQuote);

    updateState({ status: hasValidExistingQuote ? 'building' : 'quoting', error: null });
    
    try {
      const quote = hasValidExistingQuote ? existingQuote! : await quoteNameChangeCost();
      
      // Name change might be free
      if (quote.seedAmount > BigInt(0) && !isQuoteValid(quote)) {
        throw new Error(quote.error || 'Failed to get quote from BaseSwap');
      }
      
      updateState({ quote, status: 'building' });
      
      const tx = await buildSetNameTransaction(solanaAddress, plantId, name, quote);
      updateState({ status: 'ready', transaction: tx });
      return tx;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to build name transaction';
      updateState({ status: 'error', error: message });
      return null;
    }
  }, [solanaAddress, needsSetup, updateState, state.quote]);
  
  // Execute prepared transaction
  const execute = useCallback(async (
    signTransaction: (transaction: Transaction) => Promise<Transaction>
  ): Promise<string | null> => {
    if (!state.transaction || !solanaAddress) {
      updateState({ error: 'No transaction prepared or wallet not connected' });
      return null;
    }
    
    updateState({ status: 'signing' });
    
    try {
      // Check SOL balance first
      const balanceCheck = await checkSolBalance(
        solanaAddress,
        state.transaction.params.solAmount
      );
      
      if (!balanceCheck.hasEnough) {
        throw new Error(
          `Insufficient SOL balance. Have: ${balanceCheck.formatted.balance} SOL, Need: ${balanceCheck.formatted.required} SOL`
        );
      }
      
      updateState({ status: 'bridging' });
      
      // Execute the actual bridge transaction
      const result = await executeBridgeTransaction({
        solanaPublicKey: solanaAddress,
        params: state.transaction.params,
        signTransaction,
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Bridge transaction failed');
      }
      
      updateState({ status: 'success', signature: result.signature });
      return result.signature;
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transaction failed';
      updateState({ status: 'error', error: message });
      return null;
    }
  }, [state.transaction, solanaAddress, updateState]);
  
  return {
    state,
    needsSetup,
    prepareSetup,
    prepareMint,
    prepareShopItem,
    prepareGardenItem,
    prepareBoxGame,
    prepareSpinGame,
    prepareAttack,
    prepareClaimRewards,
    prepareSetName,
    execute,
    reset,
    getQuote,
  };
}
