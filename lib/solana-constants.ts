/**
 * Solana Bridge Constants
 * Configuration for Base-Solana bridge integration
 * MAINNET ONLY - No devnet/sepolia support
 */

// ============ Bridge Program Addresses (Mainnet Only) ============

export const SOLANA_BRIDGE_CONFIG = {
  // Solana Mainnet Programs
  solana: {
    bridgeProgram: 'HNCne2FkVaNghhjKXapxJzPaBvAKDG1Ge3gqhZyfVWLM',
    baseRelayerProgram: 'g1et5VenhfJHJwsdJsDbxWZuotD5H4iELNG61kS4fb9',
    gasFeeReceiver: '4m2jaKbJ4pDZw177BmLPMLsztPF5eVFo2fvxPgajdBNz',
    rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    blockExplorer: 'https://explorer.solana.com',
  },
  // Base Mainnet Contracts
  base: {
    bridge: '0x3eff766C76a1be2Ce1aCF2B69c78bCae257D5188',
    bridgeValidator: '0xAF24c1c24Ff3BF1e6D882518120fC25442d6794B',
    crossChainFactory: '0xDD56781d0509650f8C2981231B6C917f2d5d7dF2',
    relayerOrchestrator: '0x8Cfa6F29930E6310B6074baB0052c14a709B4741',
    wrappedSOL: '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82',
    chainId: 8453,
  },
} as const;

// ============ Pixotchi Contract Addresses ============

export const PIXOTCHI_SOLANA_CONFIG = {
  // The SolanaTwinAdapter contract address on Base Mainnet
  // This MUST be set for Solana integration to work
  twinAdapter: process.env.NEXT_PUBLIC_SOLANA_TWIN_ADAPTER || '',
  // Pixotchi Plants Router (ERC-7504 Dynamic Contract)
  pixotchi: '0xeb4e16c804AE9275a655AbBc20cD0658A91F9235',
  // SEED token (18 decimals)
  seedToken: '0x546D239032b24eCEEE0cb05c92FC39090846adc7',
  // BaseSwap Router (UniswapV2 fork) - same as NEXT_PUBLIC_UNISWAP_CONTRACT_ADDRESS
  baseSwapRouter: '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86',
  // wSOL on Base from the Bridge (9 decimals, same as native SOL)
  // IMPORTANT: This must match SOLANA_BRIDGE_CONFIG.base.wrappedSOL
  wsolToken: '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82',
  // WETH on Base (18 decimals) - same as NEXT_PUBLIC_SWAP_WETH_ADDRESS
  wethToken: '0x4200000000000000000000000000000000000006',
} as const;

// ============ Bridge Configuration ============

export const BRIDGE_CONFIG = {
  // Default gas limit for simple bridge transactions (transfers, setup)
  defaultGasLimit: BigInt(200000),

  // High gas limit for complex actions (Mint, Shop, Garden)
  // Includes: Transfer + Aerodrome Swap + BaseSwap Swap + Game Logic + Mint + Overheads
  // Actual usage ~1.2M observed, setting 3M for safety margin
  complexGasLimit: BigInt(3000000),

  // Medium gas limit for simple game actions (Attack, Arcade)
  // Includes: Logic + Score Updates + Event Emission
  mediumGasLimit: BigInt(400000),

  // Minimum bridge amount in SOL (lamports)
  minBridgeAmount: BigInt(1000000), // 0.001 SOL

  // Estimated time for bridge confirmation (ms)
  estimatedBridgeTime: 30000, // 30 seconds

  // Bridge fee in SOL (estimate)
  bridgeFeeEstimate: 0.003, // 0.003 SOL

  // Default slippage for app-side quotes (7% for cross-chain)
  defaultSlippagePercent: 7,

  // Contract-level extra slippage buffer (basis points)
  // Applied on top of app slippage for safety
  contractExtraSlippageBps: 200, // 2%

  // Total effective slippage: ~9% (7% app + 2% contract buffer)

  // Max slippage allowed (basis points)
  maxSlippageBps: 1000, // 10%
} as const;

// ============ Bridge ABI (getPredictedTwinAddress) ============

export const BRIDGE_ABI = [
  {
    name: 'getPredictedTwinAddress',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ internalType: 'bytes32', name: 'sender', type: 'bytes32' }],
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
  },
] as const;

// ============ SolanaTwinAdapterV2 ABI ============
// V2: onchain swaps via Aerodrome + BaseSwap - NO external swap calldata needed

export const SOLANA_TWIN_ADAPTER_ABI = [
  // View functions - SEED price getters
  {
    name: 'getMintPriceInSeed',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'strain', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getShopItemPriceInSeed',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'itemId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getGardenItemPriceInSeed',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'itemId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getNameChangePriceInSeed',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'isTwinSetup',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'twin', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getWsolForSeed',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'seedAmount', type: 'uint256' }],
    outputs: [{ name: 'wsolNeeded', type: 'uint256' }],
  },
  // Write functions - V2 simplified (no swapTarget/swapData)
  {
    name: 'mintWithWsol',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'strain', type: 'uint256' },
      { name: 'wsolAmount', type: 'uint256' },
      { name: 'minSeedOut', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'buyShopItemWithWsol',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'plantId', type: 'uint256' },
      { name: 'itemId', type: 'uint256' },
      { name: 'wsolAmount', type: 'uint256' },
      { name: 'minSeedOut', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'buyGardenItemWithWsol',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'plantId', type: 'uint256' },
      { name: 'itemId', type: 'uint256' },
      { name: 'wsolAmount', type: 'uint256' },
      { name: 'minSeedOut', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'setPlantNameWithWsol',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'plantId', type: 'uint256' },
      { name: 'name', type: 'string' },
      { name: 'wsolAmount', type: 'uint256' },
      { name: 'minSeedOut', type: 'uint256' },
    ],
    outputs: [],
  },
  // Free actions (no wsolAmount needed)
  {
    name: 'playBoxGame',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'plantId', type: 'uint256' },
      { name: 'seed', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'playSpinGame',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'plantId', type: 'uint256' },
      { name: 'seed', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'attackPlant',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'fromId', type: 'uint256' },
      { name: 'toId', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'claimRewards',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'plantId', type: 'uint256' }],
    outputs: [],
  },
] as const;

// ============ BaseSwap Router ABI (UniswapV2 fork) ============
// Same router used by the original Pixotchi app for swaps

export const BASESWAP_ROUTER_ABI = [
  {
    name: 'getAmountsIn',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'path', type: 'address[]' }
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }]
  },
  {
    name: 'getAmountsOut',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' }
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }]
  },
  {
    name: 'swapExactTokensForTokens',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' }
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }]
  },
  {
    name: 'swapExactETHForTokens',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' }
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }]
  },
] as const;

// ============ wSOL ERC20 ABI (for approvals) ============

export const WSOL_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
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
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// ============ Types ============

export interface SolanaBridgeConfig {
  solana: {
    bridgeProgram: string;
    baseRelayerProgram: string;
    gasFeeReceiver: string;
    rpcUrl: string;
    blockExplorer: string;
  };
  base: {
    bridge: string;
    bridgeValidator: string;
    crossChainFactory: string;
    relayerOrchestrator: string;
    wrappedSOL: string;
    chainId: number;
  };
}

export interface PixotchiSolanaConfig {
  twinAdapter: string;
  pixotchi: string;
  seedToken: string;
  baseSwapRouter: string;
  wsolToken: string;
  wethToken: string;
}

// ============ Helper Functions ============

/**
 * Get bridge config (mainnet only)
 */
export function getBridgeConfig(): typeof SOLANA_BRIDGE_CONFIG {
  return SOLANA_BRIDGE_CONFIG;
}

/**
 * Get Pixotchi Solana config (mainnet only)
 */
export function getPixotchiSolanaConfig(): PixotchiSolanaConfig {
  return PIXOTCHI_SOLANA_CONFIG;
}

/**
 * Check if Solana integration is enabled
 * Requires NEXT_PUBLIC_SOLANA_ENABLED=true AND a valid twin adapter address
 */
export function isSolanaEnabled(): boolean {
  const envEnabled = process.env.NEXT_PUBLIC_SOLANA_ENABLED === 'true';
  const hasAdapter = !!PIXOTCHI_SOLANA_CONFIG.twinAdapter;
  return envEnabled && hasAdapter;
}

/**
 * Check if all required Solana environment variables are set
 */
export function validateSolanaConfig(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  if (!process.env.NEXT_PUBLIC_SOLANA_ENABLED) {
    missing.push('NEXT_PUBLIC_SOLANA_ENABLED');
  }

  if (!process.env.NEXT_PUBLIC_SOLANA_TWIN_ADAPTER) {
    missing.push('NEXT_PUBLIC_SOLANA_TWIN_ADAPTER');
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Get Solana explorer URL for a transaction
 */
export function getSolanaExplorerTxUrl(signature: string): string {
  return `${SOLANA_BRIDGE_CONFIG.solana.blockExplorer}/tx/${signature}`;
}

/**
 * Get Solana explorer URL for an address
 */
export function getSolanaExplorerAddressUrl(address: string): string {
  return `${SOLANA_BRIDGE_CONFIG.solana.blockExplorer}/address/${address}`;
}

/**
 * Get Base explorer URL for an address
 */
export function getBaseExplorerAddressUrl(address: string): string {
  return `https://basescan.org/address/${address}`;
}

/**
 * Get Base explorer URL for a transaction
 */
export function getBaseExplorerTxUrl(txHash: string): string {
  return `https://basescan.org/tx/${txHash}`;
}
