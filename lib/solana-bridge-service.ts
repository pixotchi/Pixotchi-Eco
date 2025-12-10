/**
 * Solana Bridge Service
 * Handles building bridge transactions from Solana to Base
 * 
 * MAINNET ONLY - No devnet support
 * 
 * V2: Contract does on-chain swaps via Aerodrome + BaseSwap
 * No external swap calldata needed - significantly smaller transaction size
 */

import { encodeFunctionData } from 'viem';
import {
  SOLANA_TWIN_ADAPTER_ABI,
  WSOL_ABI,
  BRIDGE_CONFIG,
  getBridgeConfig,
  getPixotchiSolanaConfig,
} from './solana-constants';
import { getTwinAddress } from './solana-twin';
import type { SolanaQuoteResult } from './solana-quote';

// ============ Types ============

export type BridgeActionType = 
  | 'setup'           // Initial wSOL approval
  | 'mint'            // Mint a plant
  | 'shopItem'        // Buy shop item
  | 'gardenItem'      // Buy garden item
  | 'boxGame'         // Play box game
  | 'spinGame'        // Play spin game
  | 'attack'          // Attack another plant
  | 'claimRewards'    // Claim ETH rewards
  | 'setName';        // Set plant name

export interface BridgeCallData {
  /** Target contract address on Base */
  target: string;
  /** ABI-encoded function call data */
  data: `0x${string}`;
  /** ETH value to send (usually 0 for our calls) */
  value?: bigint;
}

export interface BridgeTransactionParams {
  /** Solana wallet public key (base58) */
  solanaPublicKey: string;
  /** Amount of SOL to bridge (in lamports, 9 decimals) */
  solAmount: bigint;
  /** The Twin address on Base (destination) */
  twinAddress: string;
  /** Optional contract call to execute after bridging */
  call?: BridgeCallData;
  /** Gas limit for execution on Base (defaults to standard limit if undefined) */
  gasLimit?: bigint;
}

export interface BridgeTransaction {
  /** Transaction parameters */
  params: BridgeTransactionParams;
  /** The action type */
  actionType: BridgeActionType;
  /** Human-readable description */
  description: string;
  /** Estimated time for confirmation (ms) */
  estimatedTime: number;
  /** Quote used (for paid actions) */
  quote?: SolanaQuoteResult;
}

// Bridge fee in SOL (lamports) to ensure Twin receives enough wSOL
// 0.003 SOL = 3,000,000 lamports
const BRIDGE_FEE_LAMPORTS = BigInt(3_000_000);

// ============ Transaction Builders ============
// V2: On-chain swaps - no external swap calldata needed

/**
 * Build a setup transaction (approves wSOL to adapter)
 * This only needs to be done once per Twin
 */
export async function buildSetupTransaction(
  solanaPublicKey: string
): Promise<BridgeTransaction> {
  const config = getPixotchiSolanaConfig();
  const bridgeConfig = getBridgeConfig();
  const twinAddress = await getTwinAddress(solanaPublicKey);
  
  if (!config.twinAdapter) {
    throw new Error('SolanaTwinAdapter address not configured. Set NEXT_PUBLIC_SOLANA_TWIN_ADAPTER.');
  }
  
  // Build approve call for max uint256
  const callData = encodeFunctionData({
    abi: WSOL_ABI,
    functionName: 'approve',
    args: [
      config.twinAdapter as `0x${string}`,
      BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'), // Max uint256
    ],
  });
  
  return {
    params: {
      solanaPublicKey,
      solAmount: BRIDGE_CONFIG.minBridgeAmount + BRIDGE_FEE_LAMPORTS,
      twinAddress,
      call: {
        target: bridgeConfig.base.wrappedSOL,
        data: callData,
      },
      gasLimit: BRIDGE_CONFIG.defaultGasLimit,
    },
    actionType: 'setup',
    description: 'Setup Solana bridge access (one-time)',
    estimatedTime: BRIDGE_CONFIG.estimatedBridgeTime,
  };
}

/**
 * Build a mint transaction
 * V2: No swap calldata needed - contract does on-chain swap
 */
export async function buildMintTransaction(
  solanaPublicKey: string,
  strain: number,
  quote: SolanaQuoteResult
): Promise<BridgeTransaction> {
  try {
    console.log('[buildMintTransaction] Starting (V2 - on-chain swap):', {
      solanaPublicKey,
      strain,
      wsolAmount: quote.wsolAmount?.toString(),
      minSeedOut: quote.minSeedOut?.toString(),
    });
    
    // Validate quote exists
    if (!quote.wsolAmount || quote.wsolAmount <= BigInt(0)) {
      throw new Error('Quote required: wsolAmount must be provided by app');
    }
    if (!quote.minSeedOut || quote.minSeedOut <= BigInt(0)) {
      throw new Error('Quote required: minSeedOut must be provided by app');
    }
    
    console.log('[buildMintTransaction] Getting config and twin address...');
    const config = getPixotchiSolanaConfig();
    
    if (!config.twinAdapter) {
      throw new Error('SolanaTwinAdapter address not configured. Set NEXT_PUBLIC_SOLANA_TWIN_ADAPTER.');
    }
    
    let twinAddress: string;
    try {
      twinAddress = await getTwinAddress(solanaPublicKey);
      console.log('[buildMintTransaction] Twin address obtained:', twinAddress);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[buildMintTransaction] Failed to get twin address:', {
        solanaPublicKey,
        error: errorMsg,
      });
      throw new Error(`Failed to resolve Twin address: ${errorMsg}`);
    }
    
    // V2: Simple call - no swapTarget/swapData needed
    // Contract does on-chain swap via Aerodrome + BaseSwap
    console.log('[buildMintTransaction] Encoding function data (V2)...');
    const callData = encodeFunctionData({
      abi: SOLANA_TWIN_ADAPTER_ABI,
      functionName: 'mintWithWsol',
      args: [
        BigInt(strain), 
        quote.wsolAmount, 
        quote.minSeedOut,
      ],
    });
    
    console.log('[buildMintTransaction] Transaction built successfully, callData length:', callData.length);
    
    return {
      params: {
        solanaPublicKey,
        solAmount: quote.wsolAmount + BRIDGE_FEE_LAMPORTS,
        twinAddress,
        call: {
          target: config.twinAdapter,
          data: callData,
        },
        gasLimit: BRIDGE_CONFIG.complexGasLimit,
      },
      actionType: 'mint',
      description: `Mint plant (Strain ${strain})`,
      estimatedTime: BRIDGE_CONFIG.estimatedBridgeTime,
      quote,
    };
  } catch (error) {
    console.error('[buildMintTransaction] Error:', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Build a shop item purchase transaction
 * V2: No swap calldata needed - contract does on-chain swap
 */
export async function buildShopItemTransaction(
  solanaPublicKey: string,
  plantId: number,
  itemId: number,
  quote: SolanaQuoteResult
): Promise<BridgeTransaction> {
  if (!quote.wsolAmount || quote.wsolAmount <= BigInt(0)) {
    throw new Error('Quote required: wsolAmount must be provided by app');
  }
  
  const config = getPixotchiSolanaConfig();
  const twinAddress = await getTwinAddress(solanaPublicKey);
  
  if (!config.twinAdapter) {
    throw new Error('SolanaTwinAdapter address not configured. Set NEXT_PUBLIC_SOLANA_TWIN_ADAPTER.');
  }
  
  // V2: Simple call - no swapTarget/swapData needed
  const callData = encodeFunctionData({
    abi: SOLANA_TWIN_ADAPTER_ABI,
    functionName: 'buyShopItemWithWsol',
    args: [
      BigInt(plantId), 
      BigInt(itemId), 
      quote.wsolAmount, 
      quote.minSeedOut,
    ],
  });
  
  return {
    params: {
      solanaPublicKey,
      solAmount: quote.wsolAmount + BRIDGE_FEE_LAMPORTS,
      twinAddress,
      call: {
        target: config.twinAdapter,
        data: callData,
      },
      gasLimit: BRIDGE_CONFIG.complexGasLimit,
    },
    actionType: 'shopItem',
    description: `Buy shop item #${itemId} for plant #${plantId}`,
    estimatedTime: BRIDGE_CONFIG.estimatedBridgeTime,
    quote,
  };
}

/**
 * Build a garden item purchase transaction
 * V2: No swap calldata needed - contract does on-chain swap
 */
export async function buildGardenItemTransaction(
  solanaPublicKey: string,
  plantId: number,
  itemId: number,
  quote: SolanaQuoteResult
): Promise<BridgeTransaction> {
  if (!quote.wsolAmount || quote.wsolAmount <= BigInt(0)) {
    throw new Error('Quote required: wsolAmount must be provided by app');
  }
  
  const config = getPixotchiSolanaConfig();
  const twinAddress = await getTwinAddress(solanaPublicKey);
  
  if (!config.twinAdapter) {
    throw new Error('SolanaTwinAdapter address not configured. Set NEXT_PUBLIC_SOLANA_TWIN_ADAPTER.');
  }
  
  // V2: Simple call - no swapTarget/swapData needed
  const callData = encodeFunctionData({
    abi: SOLANA_TWIN_ADAPTER_ABI,
    functionName: 'buyGardenItemWithWsol',
    args: [
      BigInt(plantId), 
      BigInt(itemId), 
      quote.wsolAmount, 
      quote.minSeedOut,
    ],
  });
  
  return {
    params: {
      solanaPublicKey,
      solAmount: quote.wsolAmount + BRIDGE_FEE_LAMPORTS,
      twinAddress,
      call: {
        target: config.twinAdapter,
        data: callData,
      },
      gasLimit: BRIDGE_CONFIG.complexGasLimit,
    },
    actionType: 'gardenItem',
    description: `Give garden item #${itemId} to plant #${plantId}`,
    estimatedTime: BRIDGE_CONFIG.estimatedBridgeTime,
    quote,
  };
}

/**
 * Build a box game transaction (no SEED cost, just bridge gas)
 */
export async function buildBoxGameTransaction(
  solanaPublicKey: string,
  plantId: number
): Promise<BridgeTransaction> {
  const config = getPixotchiSolanaConfig();
  const twinAddress = await getTwinAddress(solanaPublicKey);
  
  if (!config.twinAdapter) {
    throw new Error('SolanaTwinAdapter address not configured. Set NEXT_PUBLIC_SOLANA_TWIN_ADAPTER.');
  }
  
  // Generate random seed
  const seed = Math.floor(Math.random() * 1000000);
  
  const callData = encodeFunctionData({
    abi: SOLANA_TWIN_ADAPTER_ABI,
    functionName: 'playBoxGame',
    args: [BigInt(plantId), BigInt(seed)],
  });
  
  return {
    params: {
      solanaPublicKey,
      solAmount: BRIDGE_CONFIG.minBridgeAmount + BRIDGE_FEE_LAMPORTS,
      twinAddress,
      call: {
        target: config.twinAdapter,
        data: callData,
      },
      gasLimit: BRIDGE_CONFIG.mediumGasLimit,
    },
    actionType: 'boxGame',
    description: `Play Box Game with plant #${plantId}`,
    estimatedTime: BRIDGE_CONFIG.estimatedBridgeTime,
  };
}

/**
 * Build a spin game transaction
 */
export async function buildSpinGameTransaction(
  solanaPublicKey: string,
  plantId: number
): Promise<BridgeTransaction> {
  const config = getPixotchiSolanaConfig();
  const twinAddress = await getTwinAddress(solanaPublicKey);
  
  if (!config.twinAdapter) {
    throw new Error('SolanaTwinAdapter address not configured. Set NEXT_PUBLIC_SOLANA_TWIN_ADAPTER.');
  }
  
  const seed = Math.floor(Math.random() * 1000000);
  
  const callData = encodeFunctionData({
    abi: SOLANA_TWIN_ADAPTER_ABI,
    functionName: 'playSpinGame',
    args: [BigInt(plantId), BigInt(seed)],
  });
  
  return {
    params: {
      solanaPublicKey,
      solAmount: BRIDGE_CONFIG.minBridgeAmount + BRIDGE_FEE_LAMPORTS,
      twinAddress,
      call: {
        target: config.twinAdapter,
        data: callData,
      },
      gasLimit: BRIDGE_CONFIG.mediumGasLimit,
    },
    actionType: 'spinGame',
    description: `Play Spin Game with plant #${plantId}`,
    estimatedTime: BRIDGE_CONFIG.estimatedBridgeTime,
  };
}

/**
 * Build an attack transaction
 */
export async function buildAttackTransaction(
  solanaPublicKey: string,
  fromPlantId: number,
  toPlantId: number
): Promise<BridgeTransaction> {
  const config = getPixotchiSolanaConfig();
  const twinAddress = await getTwinAddress(solanaPublicKey);
  
  if (!config.twinAdapter) {
    throw new Error('SolanaTwinAdapter address not configured. Set NEXT_PUBLIC_SOLANA_TWIN_ADAPTER.');
  }
  
  const callData = encodeFunctionData({
    abi: SOLANA_TWIN_ADAPTER_ABI,
    functionName: 'attackPlant',
    args: [BigInt(fromPlantId), BigInt(toPlantId)],
  });
  
  return {
    params: {
      solanaPublicKey,
      solAmount: BRIDGE_CONFIG.minBridgeAmount + BRIDGE_FEE_LAMPORTS,
      twinAddress,
      call: {
        target: config.twinAdapter,
        data: callData,
      },
      gasLimit: BRIDGE_CONFIG.mediumGasLimit,
    },
    actionType: 'attack',
    description: `Attack plant #${toPlantId} with plant #${fromPlantId}`,
    estimatedTime: BRIDGE_CONFIG.estimatedBridgeTime,
  };
}

/**
 * Build a claim rewards transaction
 */
export async function buildClaimRewardsTransaction(
  solanaPublicKey: string,
  plantId: number
): Promise<BridgeTransaction> {
  const config = getPixotchiSolanaConfig();
  const twinAddress = await getTwinAddress(solanaPublicKey);
  
  if (!config.twinAdapter) {
    throw new Error('SolanaTwinAdapter address not configured. Set NEXT_PUBLIC_SOLANA_TWIN_ADAPTER.');
  }
  
  const callData = encodeFunctionData({
    abi: SOLANA_TWIN_ADAPTER_ABI,
    functionName: 'claimRewards',
    args: [BigInt(plantId)],
  });
  
  return {
    params: {
      solanaPublicKey,
      solAmount: BRIDGE_CONFIG.minBridgeAmount + BRIDGE_FEE_LAMPORTS,
      twinAddress,
      call: {
        target: config.twinAdapter,
        data: callData,
      },
      gasLimit: BRIDGE_CONFIG.defaultGasLimit,
    },
    actionType: 'claimRewards',
    description: `Claim rewards for plant #${plantId}`,
    estimatedTime: BRIDGE_CONFIG.estimatedBridgeTime,
  };
}

/**
 * Build a set name transaction
 * V2: No swap calldata needed - contract does on-chain swap
 */
export async function buildSetNameTransaction(
  solanaPublicKey: string,
  plantId: number,
  name: string,
  quote: SolanaQuoteResult
): Promise<BridgeTransaction> {
  const config = getPixotchiSolanaConfig();
  const twinAddress = await getTwinAddress(solanaPublicKey);
  
  if (!config.twinAdapter) {
    throw new Error('SolanaTwinAdapter address not configured. Set NEXT_PUBLIC_SOLANA_TWIN_ADAPTER.');
  }
  
  // Name change may or may not cost SEED
  const wsolAmount = quote.wsolAmount || BigInt(0);
  const minSeedOut = quote.minSeedOut || BigInt(0);
  
  // Calculate bridge amount
  const baseBridgeAmount = wsolAmount > BigInt(0) ? wsolAmount : BRIDGE_CONFIG.minBridgeAmount;
  const bridgeAmount = baseBridgeAmount + BRIDGE_FEE_LAMPORTS;
  
  // V2: Simple call - no swapTarget/swapData needed
  const callData = encodeFunctionData({
    abi: SOLANA_TWIN_ADAPTER_ABI,
    functionName: 'setPlantNameWithWsol',
    args: [
      BigInt(plantId), 
      name, 
      wsolAmount, 
      minSeedOut,
    ],
  });
  
  const isFree = wsolAmount === BigInt(0);
  
  return {
    params: {
      solanaPublicKey,
      solAmount: bridgeAmount,
      twinAddress,
      call: {
        target: config.twinAdapter,
        data: callData,
      },
      gasLimit: isFree ? BRIDGE_CONFIG.defaultGasLimit : BRIDGE_CONFIG.complexGasLimit,
    },
    actionType: 'setName',
    description: `Rename plant #${plantId} to "${name}"`,
    estimatedTime: BRIDGE_CONFIG.estimatedBridgeTime,
    quote: wsolAmount > BigInt(0) ? quote : undefined,
  };
}

// ============ Utility Functions ============

/**
 * Check if a transaction requires setup first
 */
export function requiresSetup(actionType: BridgeActionType): boolean {
  const requiresWsolApproval: BridgeActionType[] = [
    'mint',
    'shopItem',
    'gardenItem',
    'setName',
  ];
  
  return requiresWsolApproval.includes(actionType);
}

/**
 * Check if an action requires a quote from the app
 */
export function requiresQuote(actionType: BridgeActionType): boolean {
  const paidActions: BridgeActionType[] = [
    'mint',
    'shopItem',
    'gardenItem',
    'setName',
  ];
  
  return paidActions.includes(actionType);
}

/**
 * Get human-readable action description
 */
export function getActionDescription(actionType: BridgeActionType): string {
  const descriptions: Record<BridgeActionType, string> = {
    setup: 'Setup Bridge Access',
    mint: 'Mint Plant',
    shopItem: 'Buy Shop Item',
    gardenItem: 'Buy Garden Item',
    boxGame: 'Play Box Game',
    spinGame: 'Play Spin Game',
    attack: 'Attack Plant',
    claimRewards: 'Claim Rewards',
    setName: 'Set Plant Name',
  };
  
  return descriptions[actionType] || 'Unknown Action';
}
