import { createPublicClient, createWalletClient, custom, WalletClient, getAddress, parseUnits, formatUnits, PublicClient } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { Plant, ShopItem, Strain, GardenItem, Land, FenceV2State } from './types';
import UniswapAbi from '@/public/abi/Uniswap.json';
import { landAbi } from '../public/abi/pixotchi-v3-abi';
import { leafAbi } from '../public/abi/leaf-abi';
import { stakingAbi } from '@/public/abi/staking-abi';
import { fenceV2Abi } from '@/public/abi/fence-v2-abi';
import { CLIENT_ENV } from './env-config';
import { createResilientTransport, getRpcEndpoints } from './rpc-transport';
export { getRpcDiagnostics } from './rpc-transport';

export const LAND_CONTRACT_ADDRESS = getAddress(CLIENT_ENV.LAND_CONTRACT_ADDRESS);
export const LEAF_CONTRACT_ADDRESS = getAddress(CLIENT_ENV.LEAF_CONTRACT_ADDRESS);
export const STAKE_CONTRACT_ADDRESS = getAddress(CLIENT_ENV.STAKE_CONTRACT_ADDRESS);
export const PIXOTCHI_NFT_ADDRESS = getAddress('0xeb4e16c804AE9275a655AbBc20cD0658A91F9235');
export const PIXOTCHI_TOKEN_ADDRESS = getAddress('0x546D239032b24eCEEE0cb05c92FC39090846adc7');
export const BATCH_ROUTER_ADDRESS = CLIENT_ENV.BATCH_ROUTER_ADDRESS ? getAddress(CLIENT_ENV.BATCH_ROUTER_ADDRESS) : undefined as unknown as `0x${string}`;
export const UNISWAP_ROUTER_ADDRESS = getAddress('0x327Df1E6de05895d2ab08513aaDD9313Fe505d86'); // BaseSwap Router (Uniswap V2 Fork)
export const WETH_ADDRESS = getAddress('0x4200000000000000000000000000000000000006');
export const FENCE_V2_EXTENSION_ADDRESS = PIXOTCHI_NFT_ADDRESS;

const isFenceItemName = (name: unknown): boolean => {
  if (typeof name !== 'string') return false;
  const lower = name.toLowerCase();
  return lower.includes('fence') || lower.includes('shield');
};

const approxTimestampEqual = (a: number, b: number): boolean => Math.abs(a - b) <= 1;

const getMaxFenceEffectUntil = (extensions: any[]): number => {
  let max = 0;
  if (!Array.isArray(extensions)) return max;
  for (const extension of extensions) {
    const owned = extension?.shopItemOwned || [];
    if (!Array.isArray(owned)) continue;
    for (const item of owned) {
      if (!item?.effectIsOngoingActive) continue;
      if (!isFenceItemName(item?.name)) continue;
      const effectUntil = Number(item?.effectUntil ?? 0);
      if (!Number.isFinite(effectUntil)) continue;
      if (effectUntil > max) max = effectUntil;
    }
  }
  return max;
};

// Common constants
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const SYSTEM_ADDRESS = '0x0000000000000000000000000000000000000001';
export const USDC_ADDRESS = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');

// EVM event signatures for log parsing
export const EVM_EVENT_SIGNATURES = {
  // ERC20 Transfer(address indexed from, address indexed to, uint256 value)
  ERC20_TRANSFER: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
} as const;

// Topic constants for log filtering
export const EVM_TOPICS = {
  ZERO_ADDRESS_TOPIC: '0x0000000000000000000000000000000000000000000000000000000000000000',
} as const;

// Address validation pattern
export const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

// Centralized ABI definitions to avoid duplication
export const ERC20_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const;

export const ERC20_BALANCE_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const BOX_GAME_ABI = [
  {
    inputs: [{ name: "nftID", type: "uint256" }],
    name: "boxGameGetCoolDownTimePerNFT",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "nftID", type: "uint256" }],
    name: "boxGameGetCoolDownTimeWithStar",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "nftID", type: "uint256" },
      { name: "seed", type: "uint256" },
    ],
    name: "boxGamePlay",
    outputs: [
      { name: "points", type: "uint256" },
      { name: "timeExtension", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "nftID", type: "uint256" },
      { name: "seed", type: "uint256" },
    ],
    name: "boxGamePlayWithStar",
    outputs: [
      { name: "points", type: "uint256" },
      { name: "timeExtension", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const SPIN_GAME_ABI = [
  {
    inputs: [],
    name: "getCoolDownTime",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getStarCost",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "index", type: "uint256" }],
    name: "getReward",
    outputs: [
      { name: "pointsDelta", type: "int256" },
      { name: "timeExtension", type: "uint256" },
      { name: "leafAmount", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "nftID", type: "uint256" }],
    name: "spinGameV2GetCoolDownTimePerNFT",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "nftId", type: "uint256" },
      { name: "commitment", type: "bytes32" },
    ],
    name: "spinGameV2Commit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "nftId", type: "uint256" },
      { name: "secret", type: "bytes32" },
    ],
    name: "spinGameV2Play",
    outputs: [
      { name: "pointsDelta", type: "int256" },
      { name: "timeAdded", type: "uint256" },
      { name: "leafAmount", type: "uint256" },
      { name: "rewardIndex", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// Provider caching to avoid recreating clients
let cachedReadClient: any = null;
let cachedWriteClient: any = null;

// Create optimized read client for data fetching
export const getReadClient = () => {
  if (!cachedReadClient) {
    const endpoints = getRpcEndpoints();
    
    // Only log in development
    if (process.env.NODE_ENV === 'development') {
      console.log('🔗 Creating READ client with configured RPC endpoints');
    }
    
    cachedReadClient = createPublicClient({
      chain: base,
      transport: createResilientTransport(endpoints),
      pollingInterval: 500, // Faster polling to match Base block times (~2s)
    });
  }
  return cachedReadClient;
};

// Create optimized write client for transactions
const getWriteClient = () => {
  if (!cachedWriteClient) {
    const endpoints = getRpcEndpoints();
    
    // Only log in development
    if (process.env.NODE_ENV === 'development') {
      console.log('🔗 Creating WRITE client with configured RPC endpoints');
    }
    
    cachedWriteClient = createPublicClient({
      chain: base,
      transport: createResilientTransport(endpoints),
      pollingInterval: 500, // Faster polling to match Base block times (~2s)
    });
  }
  return cachedWriteClient;
};

// Retry logic for rate limiting and network issues
export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> => {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fn();
      // We can't tell which endpoint served this call from here; individual read helpers can annotate.
      return res;
    } catch (error: any) {
      const isRateLimit = error?.details?.includes('rate limit') || 
                          error?.message?.includes('429') ||
                          error?.status === 429;
      
      const isNetworkError = error?.message?.includes('fetch') ||
                             error?.message?.includes('network') ||
                             error?.message?.includes('timeout');
      
      if ((isRateLimit || isNetworkError) && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
        console.log(`${isRateLimit ? 'Rate limited' : 'Network error'}, retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries + 1})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
};

// Simplified contract ABIs (only the functions we need)
const PIXOTCHI_NFT_ABI = [
  {
    inputs: [
      { name: 'id', type: 'uint256' }
    ],
    name: 'redeem',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'strain', type: 'uint256' }],
    name: 'mint',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'getPlantsByOwnerExtended',
    outputs: [{ name: '', type: 'tuple[]', components: [
      { name: 'id', type: 'uint256' },
      { name: 'name', type: 'string' },
      { name: 'timeUntilStarving', type: 'uint256' },
      { name: 'score', type: 'uint256' },
      { name: 'timePlantBorn', type: 'uint256' },
      { name: 'lastAttackUsed', type: 'uint256' },
      { name: 'lastAttacked', type: 'uint256' },
      { name: 'stars', type: 'uint256' },
      { name: 'strain', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'statusStr', type: 'string' },
      { name: 'level', type: 'uint256' },
      { name: 'owner', type: 'address' },
      { name: 'rewards', type: 'uint256' },
      { name: 'extensions', type: 'tuple[]', components: [
        { name: 'shopItemOwned', type: 'tuple[]', components: [
          { name: 'id', type: 'uint256' },
          { name: 'name', type: 'string' },
          { name: 'effectUntil', type: 'uint256' },
          { name: 'effectIsOngoingActive', type: 'bool' }
        ]}
      ]}
    ]}],
    stateMutability: 'view',
    type: 'function',
  },
  {
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
      { name: 'getStrainTotalLeft', type: 'uint256' },
      { name: 'strainInitialTOD', type: 'uint256' }
    ]}],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'shopGetAllItems',
    outputs: [{ name: '', type: 'tuple[]', components: [
      { name: 'id', type: 'uint256' },
      { name: 'name', type: 'string' },
      { name: 'price', type: 'uint256' },
      { name: 'expireTime', type: 'uint256' }
    ]}],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'plantId', type: 'uint256' },
      { name: 'itemId', type: 'uint256' }
    ],
    name: 'shopBuyItem',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'airdropGetAliveAndDeadTokenIds',
    outputs: [{ name: '', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenIds', type: 'uint256[]' }],
    name: 'getPlantsInfoExtended',
    outputs: [{ name: '', type: 'tuple[]', components: [
      { name: 'id', type: 'uint256' },
      { name: 'name', type: 'string' },
      { name: 'timeUntilStarving', type: 'uint256' },
      { name: 'score', type: 'uint256' },
      { name: 'timePlantBorn', type: 'uint256' },
      { name: 'lastAttackUsed', type: 'uint256' },
      { name: 'lastAttacked', type: 'uint256' },
      { name: 'stars', type: 'uint256' },
      { name: 'strain', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'statusStr', type: 'string' },
      { name: 'level', type: 'uint256' },
      { name: 'owner', type: 'address' },
      { name: 'rewards', type: 'uint256' },
      { name: 'extensions', type: 'tuple[]', components: [
        { name: 'shopItemOwned', type: 'tuple[]', components: [
          { name: 'id', type: 'uint256' },
          { name: 'name', type: 'string' },
          { name: 'effectUntil', type: 'uint256' },
          { name: 'effectIsOngoingActive', type: 'bool' }
        ]}
      ]}
    ]}],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'nftId', type: 'uint256' },
      { name: 'itemId', type: 'uint256' }
    ],
    name: 'buyAccessory',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: '_id', type: 'uint256' },
      { name: '_name', type: 'string' }
    ],
    name: 'setPlantName',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getAllGardenItem',
    outputs: [{ 
      name: '', 
      type: 'tuple[]', 
      components: [
        { name: 'id', type: 'uint256' },
        { name: 'name', type: 'string' },
        { name: 'price', type: 'uint256' },
        { name: 'points', type: 'uint256' },
        { name: 'timeExtension', type: 'uint256' }
      ]
    }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Minimal ERC-721 ABI for transfers
const ERC721_MIN_ABI = [
  {
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' }
    ],
    name: 'transferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' }
    ],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  }
] as const;

const PIXOTCHI_TOKEN_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' }
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  }
] as const;

// -------------------- BATCH ROUTER ABI --------------------
const BATCH_ROUTER_ABI = [
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'tokenIds', type: 'uint256[]' }
    ],
    name: 'batchTransfer721',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokens', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'tokenIdsPerToken', type: 'uint256[][]' }
    ],
    name: 'batchTransfer721Multi',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// -------------------- STAKING HELPERS --------------------

// Check SEED allowance for staking contract
export const getStakeAllowance = async (ownerAddress: string): Promise<bigint> => {
  const readClient = getReadClient();
  return retryWithBackoff(async () => {
    const allowance = await readClient.readContract({
      address: PIXOTCHI_TOKEN_ADDRESS,
      abi: PIXOTCHI_TOKEN_ABI,
      functionName: 'allowance',
      args: [ownerAddress as `0x${string}`, STAKE_CONTRACT_ADDRESS],
    }) as bigint;
    return allowance;
  });
};

export const isStakeApproved = async (ownerAddress: string): Promise<boolean> => {
  try {
    const allowance = await getStakeAllowance(ownerAddress);
    return allowance > BigInt(0);
  } catch {
    return false;
  }
};

// Build approve call for UniversalTransaction
export const buildApproveStakeCall = (): { address: `0x${string}`; abi: any; functionName: string; args: any[] } => {
  const maxApproval = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');
  return {
    address: PIXOTCHI_TOKEN_ADDRESS,
    abi: PIXOTCHI_TOKEN_ABI,
    functionName: 'approve',
    args: [STAKE_CONTRACT_ADDRESS, maxApproval],
  } as const;
};

export const buildStakeCall = (amount: string): { address: `0x${string}`; abi: any; functionName: string; args: any[] } => {
  const amountWei = parseUnits(amount || '0', 18);
  return {
    address: STAKE_CONTRACT_ADDRESS,
    abi: stakingAbi,
    functionName: 'stake',
    args: [amountWei],
  } as const;
};

export const buildUnstakeCall = (amount: string): { address: `0x${string}`; abi: any; functionName: string; args: any[] } => {
  const amountWei = parseUnits(amount || '0', 18);
  return {
    address: STAKE_CONTRACT_ADDRESS,
    abi: stakingAbi,
    functionName: 'withdraw',
    args: [amountWei],
  } as const;
};

export const buildClaimRewardsCall = (): { address: `0x${string}`; abi: any; functionName: string; args: any[] } => {
  return {
    address: STAKE_CONTRACT_ADDRESS,
    abi: stakingAbi,
    functionName: 'claimRewards',
    args: [],
  } as const;
};

export const getStakeInfo = async (address: string): Promise<{ staked: bigint; rewards: bigint } | null> => {
  const readClient = getReadClient();
  try {
    const result = await retryWithBackoff(async () => {
      const info = await readClient.readContract({
        address: STAKE_CONTRACT_ADDRESS,
        abi: stakingAbi,
        functionName: 'getStakeInfo',
        args: [address as `0x${string}`],
      });
      return info as any;
    });
    // Normalize possible return shapes
    if (Array.isArray(result)) {
      const [staked, rewards] = result as [bigint, bigint];
      return { staked, rewards };
    }
    if (typeof result === 'object' && result) {
      const staked = (result.staked ?? result[0]) as bigint;
      const rewards = (result.rewards ?? result[1]) as bigint;
      return { staked, rewards };
    }
    return null;
  } catch (e) {
    console.warn('getStakeInfo failed:', e);
    return null;
  }
};

// Optimized composite fetch for staking-specific data only (no balance duplication)
export const getStakeComposite = async (
  ownerAddress: string
): Promise<{
  stake: { staked: bigint; rewards: bigint } | null;
  approved: boolean;
  rewardRatio: { numerator: bigint; denominator: bigint } | null;
  timeUnit: bigint | null;
  totalStaked: bigint | null;
}> => {
  const readClient = getReadClient();
  try {
    const [stakeRes, allowanceRes, rewardRatioRes, timeUnitRes, totalStakedRes] = await retryWithBackoff(async () => {
      const results = await readClient.multicall({
        contracts: [
          {
            address: STAKE_CONTRACT_ADDRESS,
            abi: stakingAbi,
            functionName: 'getStakeInfo',
            args: [ownerAddress as `0x${string}`],
          },
          {
            address: PIXOTCHI_TOKEN_ADDRESS,
            abi: PIXOTCHI_TOKEN_ABI,
            functionName: 'allowance',
            args: [ownerAddress as `0x${string}`, STAKE_CONTRACT_ADDRESS],
          },
          {
            address: STAKE_CONTRACT_ADDRESS,
            abi: stakingAbi,
            functionName: 'getRewardRatio',
            args: [],
          },
          {
            address: STAKE_CONTRACT_ADDRESS,
            abi: stakingAbi,
            functionName: 'getTimeUnit',
            args: [],
          },
          {
            address: STAKE_CONTRACT_ADDRESS,
            abi: stakingAbi,
            functionName: 'stakingTokenBalance',
            args: [],
          },
        ],
        allowFailure: true,
      });
      return results as any[];
    });

    let stake: { staked: bigint; rewards: bigint } | null = null;
    const sr = stakeRes?.result as any;
    if (Array.isArray(sr)) {
      stake = { staked: sr[0] as bigint, rewards: sr[1] as bigint };
    } else if (sr && typeof sr === 'object') {
      stake = { staked: (sr.staked ?? sr[0]) as bigint, rewards: (sr.rewards ?? sr[1]) as bigint };
    }

    const allowance = (allowanceRes?.result ?? BigInt(0)) as bigint;
    const approved = allowance > BigInt(0);

    let rewardRatio: { numerator: bigint; denominator: bigint } | null = null;
    const rr = rewardRatioRes?.result as any;
    const numerator = rr?.numerator ?? rr?.[0];
    const denominator = rr?.denominator ?? rr?.[1];
    if (typeof numerator !== 'undefined' && typeof denominator !== 'undefined') {
      try {
        rewardRatio = {
          numerator: BigInt(numerator),
          denominator: BigInt(denominator),
        };
      } catch {
        rewardRatio = null;
      }
    }

    let timeUnit: bigint | null = null;
    const timeUnitResult = timeUnitRes?.result as any;
    if (typeof timeUnitResult !== 'undefined' && timeUnitResult !== null) {
      try {
        timeUnit = BigInt(timeUnitResult);
      } catch {
        timeUnit = null;
      }
    }

    let totalStaked: bigint | null = null;
    const totalStakedRaw = totalStakedRes?.result as any;
    if (typeof totalStakedRaw !== 'undefined' && totalStakedRaw !== null) {
      try {
        totalStaked = BigInt(totalStakedRaw);
      } catch {
        totalStaked = null;
      }
    }

    return { stake, approved, rewardRatio, timeUnit, totalStaked };
  } catch (e) {
    console.warn('getStakeComposite failed:', e);
    return { stake: null, approved: false, rewardRatio: null, timeUnit: null, totalStaked: null };
  }
};

// Plant fetching (following main app's exact pattern)
export const getPlantsByOwner = async (address: string): Promise<Plant[]> => {
  const readClient = getReadClient();
  
  return retryWithBackoff(async () => {
    const plants = await readClient.readContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: 'getPlantsByOwnerExtended',
      args: [address as `0x${string}`],
    }) as any[];

    const fenceV2Map = await attachFenceV2State(readClient, plants);

    return plants.map((plant: any) => {
      const plantId = Number(plant.id);
      const extensions = plant.extensions || [];
      const fenceV1EffectUntil = getMaxFenceEffectUntil(extensions);
      const baseFenceV2 = fenceV2Map[plantId] ?? null;
      const isMirroring = baseFenceV2?.isActive && fenceV1EffectUntil > 0 && approxTimestampEqual(fenceV1EffectUntil, Number(baseFenceV2?.activeUntil ?? 0));
      const fenceV2 = baseFenceV2
        ? {
            ...baseFenceV2,
            v1Active: isMirroring ? false : baseFenceV2.v1Active,
            isMirroringV1: Boolean(isMirroring),
          }
        : null;

      return {
        id: plantId,
        name: plant.name || '',
        score: Number(plant.score),
        status: Number(plant.status),
        rewards: Number(plant.rewards),
        level: Number(plant.level),
        timeUntilStarving: Number(plant.timeUntilStarving),
        stars: Number(plant.stars),
        strain: Number(plant.strain),
        timePlantBorn: plant.timePlantBorn ? plant.timePlantBorn.toString() : '0',
        lastAttackUsed: plant.lastAttackUsed ? plant.lastAttackUsed.toString() : '0',
        lastAttacked: plant.lastAttacked ? plant.lastAttacked.toString() : '0',
        statusStr: plant.statusStr || '',
        owner: typeof plant.owner === 'string' ? plant.owner.toLowerCase() : String(plant.owner || '').toLowerCase(),
        extensions,
        fenceV2,
      };
    });
  });
};

// Explicit public-RPC variant (used by notification cron to avoid internal RPC pool)
export const getPlantsByOwnerWithRpc = async (address: string, rpcUrl: string): Promise<Plant[]> => {
  const readClient = createPublicClient({ chain: base, transport: createResilientTransport([rpcUrl]) });
  const plants = await readClient.readContract({
    address: PIXOTCHI_NFT_ADDRESS,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'getPlantsByOwnerExtended',
    args: [address as `0x${string}`],
  }) as any[];
  const fenceV2Map = await attachFenceV2State(readClient as any, plants);
  return plants.map((plant: any) => {
    const plantId = Number(plant.id);
    const extensions = plant.extensions || [];
    const fenceV1EffectUntil = getMaxFenceEffectUntil(extensions);
    const baseFenceV2 = fenceV2Map[plantId] ?? null;
    const isMirroring = baseFenceV2?.isActive && fenceV1EffectUntil > 0 && approxTimestampEqual(fenceV1EffectUntil, Number(baseFenceV2?.activeUntil ?? 0));
    const fenceV2 = baseFenceV2
      ? {
          ...baseFenceV2,
          v1Active: isMirroring ? false : baseFenceV2.v1Active,
          isMirroringV1: Boolean(isMirroring),
        }
      : null;

    return {
      id: plantId,
      name: plant.name || '',
      score: Number(plant.score),
      status: Number(plant.status),
      rewards: Number(plant.rewards),
      level: Number(plant.level),
      timeUntilStarving: Number(plant.timeUntilStarving),
      stars: Number(plant.stars),
      strain: Number(plant.strain),
      timePlantBorn: plant.timePlantBorn ? plant.timePlantBorn.toString() : '0',
      lastAttackUsed: plant.lastAttackUsed ? plant.lastAttackUsed.toString() : '0',
      lastAttacked: plant.lastAttacked ? plant.lastAttacked.toString() : '0',
      statusStr: plant.statusStr || '',
      owner: typeof plant.owner === 'string' ? plant.owner.toLowerCase() : String(plant.owner || '').toLowerCase(),
      extensions,
      fenceV2,
    };
  });
};

// Get land balance
export const getLandBalance = async (address: string): Promise<number> => {
  try {
    const lands = await getLandsByOwner(address);
    return lands.length;
  } catch (error) {
    console.error('Error fetching land balance:', error);
    return 0;
  }
};

export const getLandSupply = async (): Promise<{ totalSupply: number; maxSupply: number; }> => {
  const readClient = getReadClient();

  return retryWithBackoff(async () => {
    const [totalSupply, maxSupply] = await Promise.all([
      readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: landAbi,
        functionName: 'totalSupply',
      }),
      readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: landAbi,
        functionName: 'maxSupply',
      })
    ]);

    return {
      totalSupply: Number(totalSupply as bigint),
      maxSupply: Number(maxSupply as bigint),
    };
  });
};

export const getLandMintPrice = async (): Promise<bigint> => {
  const readClient = getReadClient();

  return retryWithBackoff(async () => {
    const price = await readClient.readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'landGetMintPrice',
    });
    return price as bigint;
  });
};

export const getLandMintStatus = async (address: `0x${string}`): Promise<{ canMint: boolean; reason: string; }> => {
  const readClient = getReadClient();

  return retryWithBackoff(async () => {
    const [isPaused, isWhitelistOnly, isWhitelisted] = await Promise.all([
      readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: landAbi,
        functionName: 'accessControlGetPaused',
      }),
      readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: landAbi,
        functionName: 'accessControlGetWhitelistOnly',
      }),
      readClient.readContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: landAbi,
        functionName: 'accessControlGetWhitelistAddress',
        args: [address],
      }),
    ]);

    if (isPaused) {
      return { canMint: false, reason: 'Minting is currently paused.' };
    }
    if (isWhitelistOnly && !isWhitelisted) {
      return { canMint: false, reason: 'Minting is restricted to whitelisted addresses.' };
    }

    return { canMint: true, reason: '' };
  });
};

export const getLandsByOwner = async (address: string): Promise<Land[]> => {
  try {
    const client = getReadClient();
    
    // Use the existing Land contract functions from the ABI
    const lands = await client.readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'landGetByOwner',
      args: [address as `0x${string}`],
    });

    return lands as Land[];
  } catch (error) {
    console.error('Error fetching user lands:', error);
    return [];
  }
};

export const getLandById = async (landId: bigint): Promise<Land | null> => {
  try {
    const client = getReadClient();
    const land = await client.readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'landGetById',
      args: [landId],
    });
    return land as Land;
  } catch (error) {
    console.error('Error fetching land by id:', error);
    return null;
  }
};

// -------------------- ASSET TRANSFERS --------------------

/**
 * Transfer a batch of plant NFTs to a destination wallet.
 */
export const transferPlants = async (
  walletClient: WalletClient,
  toAddress: string,
  plantIds: number[],
): Promise<{ successIds: number[]; failedIds: number[] }> => {
  if (!walletClient?.account) throw new Error('No account connected');
  const from = walletClient.account.address;
  const to = getAddress(toAddress);

  const writeClient = getWriteClient();
  const successIds: number[] = [];
  const failedIds: number[] = [];

  for (const id of plantIds) {
    try {
      const hash = await walletClient.writeContract({
        address: PIXOTCHI_NFT_ADDRESS,
        abi: ERC721_MIN_ABI,
        functionName: 'transferFrom',
        args: [from, to, BigInt(id)],
        account: walletClient.account,
        chain: base,
      });
      const receipt = await writeClient.waitForTransactionReceipt({ hash });
      if (receipt.status === 'success') successIds.push(id);
      else failedIds.push(id);
    } catch (e) {
      failedIds.push(id);
    }
  }

  return { successIds, failedIds };
};

/**
 * Transfer a batch of land NFTs to a destination wallet.
 */
export const transferLands = async (
  walletClient: WalletClient,
  toAddress: string,
  landTokenIds: bigint[],
): Promise<{ successIds: bigint[]; failedIds: bigint[] }> => {
  if (!walletClient?.account) throw new Error('No account connected');
  const from = walletClient.account.address;
  const to = getAddress(toAddress);

  const writeClient = getWriteClient();
  const successIds: bigint[] = [];
  const failedIds: bigint[] = [];

  for (const id of landTokenIds) {
    try {
      const hash = await walletClient.writeContract({
        address: LAND_CONTRACT_ADDRESS,
        abi: ERC721_MIN_ABI,
        functionName: 'transferFrom',
        args: [from, to, id],
        account: walletClient.account,
        chain: base,
      });
      const receipt = await writeClient.waitForTransactionReceipt({ hash });
      if (receipt.status === 'success') successIds.push(id);
      else failedIds.push(id);
    } catch (e) {
      failedIds.push(id);
    }
  }

  return { successIds, failedIds };
};

/**
 * Transfer all Pixotchi (plants) and Land NFTs owned by the current wallet to a destination address.
 */
export const transferAllAssets = async (
  walletClient: WalletClient,
  ownerAddress: string,
  toAddress: string,
): Promise<{
  plants: { total: number; success: number; failed: number };
  lands: { total: number; success: number; failed: number };
}> => {
  const plants = await getPlantsByOwner(ownerAddress);
  const lands = await getLandsByOwner(ownerAddress);
  const plantIds = plants.map(p => p.id);
  const landIds = lands.map(l => l.tokenId);

  const plantRes = await transferPlants(walletClient, toAddress, plantIds);
  const landRes = await transferLands(walletClient, toAddress, landIds);

  return {
    plants: { total: plantIds.length, success: plantRes.successIds.length, failed: plantRes.failedIds.length },
    lands: { total: landIds.length, success: landRes.successIds.length, failed: landRes.failedIds.length },
  };
};

// Token balance (returns raw bigint for precision)
export const getTokenBalance = async (address: string): Promise<bigint> => {
  const readClient = getReadClient();
  
  return retryWithBackoff(async () => {
    const balance = await readClient.readContract({
      address: PIXOTCHI_TOKEN_ADDRESS,
      abi: PIXOTCHI_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    }) as bigint;

    return balance; // Return raw bigint for precision
  });
};

// Helper function for formatted token balance
export const getFormattedTokenBalance = async (address: string): Promise<number> => {
  const balance = await getTokenBalance(address);
  return Number(balance) / 1e18; // Convert from wei to token units
};

// Raw SEED allowance for Land contract interactions (e.g., marketplace)
export const getSeedAllowanceForLand = async (ownerAddress: string): Promise<bigint> => {
  if (!ownerAddress) return BigInt(0);
  const readClient = getReadClient();

  return retryWithBackoff(async () => {
    return await readClient.readContract({
      address: PIXOTCHI_TOKEN_ADDRESS,
      abi: PIXOTCHI_TOKEN_ABI,
      functionName: 'allowance',
      args: [ownerAddress as `0x${string}`, LAND_CONTRACT_ADDRESS],
    }) as bigint;
  });
};

// Raw LEAF allowance for Land contract interactions (e.g., marketplace)
export const getLeafAllowanceForLand = async (ownerAddress: string): Promise<bigint> => {
  if (!ownerAddress) return BigInt(0);
  const readClient = getReadClient();

  return retryWithBackoff(async () => {
    return await readClient.readContract({
      address: LEAF_CONTRACT_ADDRESS,
      abi: leafAbi,
      functionName: 'allowance',
      args: [ownerAddress as `0x${string}`, LAND_CONTRACT_ADDRESS],
    }) as bigint;
  });
};

// Check token approval
export const checkTokenApproval = async (address: string): Promise<boolean> => {
  const readClient = getReadClient();
  
  return retryWithBackoff(async () => {
    const allowance = await readClient.readContract({
      address: PIXOTCHI_TOKEN_ADDRESS,
      abi: PIXOTCHI_TOKEN_ABI,
      functionName: 'allowance',
      args: [address as `0x${string}`, PIXOTCHI_NFT_ADDRESS],
    }) as bigint;

    return allowance > BigInt(0);
  });
};

export const checkLandTokenApproval = async (address: string): Promise<boolean> => {
  const readClient = getReadClient();
  
  return retryWithBackoff(async () => {
    const allowance = await readClient.readContract({
      address: PIXOTCHI_TOKEN_ADDRESS,
      abi: PIXOTCHI_TOKEN_ABI,
      functionName: 'allowance',
      args: [address as `0x${string}`, LAND_CONTRACT_ADDRESS],
    }) as bigint;

    return allowance > BigInt(0);
  });
};

// Check LEAF token approval for building upgrades
export const checkLeafTokenApproval = async (address: string): Promise<boolean> => {
  const readClient = getReadClient();
  
  return retryWithBackoff(async () => {
    const allowance = await readClient.readContract({
      address: LEAF_CONTRACT_ADDRESS,
      abi: leafAbi,
      functionName: 'allowance',
      args: [address as `0x${string}`, LAND_CONTRACT_ADDRESS],
    }) as bigint;

    return allowance > BigInt(0);
  });
};

// Get strain information (following main app pattern)
export const getStrainInfo = async (): Promise<Strain[]> => {
  const readClient = getReadClient();
  
  return retryWithBackoff(async () => {
    const strains = await readClient.readContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: 'getAllStrainInfo',
      args: [],
    }) as any[];

    return strains.map((strain: any) => ({
      id: Number(strain.id),
      name: strain.name || '',
      mintPrice: Number(strain.mintPrice) / 1e18, // Convert from wei
      totalSupply: Number(strain.totalSupply),
      totalMinted: Number(strain.totalMinted),
      maxSupply: Number(strain.maxSupply),
      isActive: Boolean(strain.isActive),
      getStrainTotalLeft: Number(strain.getStrainTotalLeft),
      strainInitialTOD: Number(strain.strainInitialTOD),
    }));
  });
};

// Get shop items
export const getShopItems = async (): Promise<ShopItem[]> => {
  const readClient = getReadClient();
  
  return retryWithBackoff(async () => {
    const items = await readClient.readContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: 'shopGetAllItems',
      args: [],
    }) as any[];

    return items.map((item: any) => ({
      id: String(item.id),
      name: item.name || '',
      price: Number(item.price) / 1e18, // Convert from wei
      effectTime: Number(item.expireTime),
    }));
  });
};

// Approve token spending
export const approveTokenSpending = async (walletClient: WalletClient): Promise<boolean> => {
  if (!walletClient.account) throw new Error('No account connected');
  
  return retryWithBackoff(async () => {
    const maxApproval = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');
    
    const hash = await walletClient.writeContract({
      address: PIXOTCHI_TOKEN_ADDRESS,
      abi: PIXOTCHI_TOKEN_ABI,
      functionName: 'approve',
      args: [PIXOTCHI_NFT_ADDRESS, maxApproval],
      account: walletClient.account!,
      chain: base,
    });

    const writeClient = getWriteClient();
    const receipt = await writeClient.waitForTransactionReceipt({ hash });
    return receipt.status === 'success';
  });
};

// Mint plant
export const mintPlant = async (walletClient: WalletClient, strain: number): Promise<boolean> => {
  if (!walletClient.account) throw new Error('No account connected');
  
  return retryWithBackoff(async () => {
    const hash = await walletClient.writeContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: 'mint',
      args: [BigInt(strain)],
      account: walletClient.account!,
      chain: base,
    });

    const writeClient = getWriteClient();
    const receipt = await writeClient.waitForTransactionReceipt({ hash });
    return receipt.status === 'success';
  });
};

// Claim plant rewards (burns score and resets level)
export const claimPlantRewards = async (walletClient: WalletClient, plantId: number): Promise<boolean> => {
  if (!walletClient.account) throw new Error('No account connected');
  return retryWithBackoff(async () => {
    const hash = await walletClient.writeContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: 'redeem',
      args: [BigInt(plantId)],
      account: walletClient.account!,
      chain: base,
    });
    const writeClient = getWriteClient();
    const receipt = await writeClient.waitForTransactionReceipt({ hash });
    return receipt.status === 'success';
  });
};

// Buy shop item
export const buyShopItem = async (
  walletClient: WalletClient, 
  plantId: number, 
  itemId: string
): Promise<boolean> => {
  if (!walletClient.account) throw new Error('No account connected');
  
  return retryWithBackoff(async () => {
    const hash = await walletClient.writeContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: 'shopBuyItem',
      args: [BigInt(plantId), BigInt(itemId)],
      account: walletClient.account!,
      chain: base,
    });

    const writeClient = getWriteClient();
    const receipt = await writeClient.waitForTransactionReceipt({ hash });
    return receipt.status === 'success';
  });
}; 

// Get all shop items
export const getAllShopItems = async (): Promise<ShopItem[]> => {
  const readClient = getReadClient();
  
  try {
    const items = await retryWithBackoff(() =>
      readClient.readContract({
        address: PIXOTCHI_NFT_ADDRESS,
        abi: PIXOTCHI_NFT_ABI,
        functionName: 'shopGetAllItems',
      })
    );

    return (items as any[]).map((item: any) => ({
      id: String(item.id),
      name: item.name || '',
      price: item.price || BigInt(0),
      effectTime: Number(item.expireTime || 0),
    }));
  } catch (error) {
    console.error('Error fetching shop items:', error);
    return [];
  }
};

// Get all garden items
export const getAllGardenItems = async (): Promise<GardenItem[]> => {
  const readClient = getReadClient();
  
  try {
    const items = await retryWithBackoff(() =>
      readClient.readContract({
        address: PIXOTCHI_NFT_ADDRESS,
        abi: PIXOTCHI_NFT_ABI,
        functionName: 'getAllGardenItem',
      })
    );

    return (items as any[]).map((item: any) => ({
      id: String(item.id),
      name: item.name || '',
      price: item.price || BigInt(0),
      points: Number(item.points),
      timeExtension: Number(item.timeExtension),
    }));
  } catch (error) {
    console.error('Error fetching garden items:', error);
    return [];
  }
};

// Buy garden item
export const buyGardenItem = async (
  walletClient: WalletClient, 
  plantId: number, 
  itemId: string
): Promise<boolean> => {
  if (!walletClient.account) throw new Error('No account connected');
  
  return retryWithBackoff(async () => {
    const hash = await walletClient.writeContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: 'buyAccessory',
      args: [BigInt(plantId), BigInt(itemId)],
      account: walletClient.account!,
      chain: base,
    });

    const writeClient = getWriteClient();
    const receipt = await writeClient.waitForTransactionReceipt({ hash });
    return receipt.status === 'success';
  });
}; 

// Get swap quote with improved error handling
export const getSwapQuote = async (ethAmount: string): Promise<{ quote: string; error?: string }> => {
  if (!ethAmount || isNaN(Number(ethAmount)) || Number(ethAmount) <= 0) {
    return { quote: "0" };
  }

  const readClient = getReadClient();
  
  try {
    const amountIn = parseUnits(ethAmount, 18);
    
    if (amountIn <= BigInt(0)) {
      return { quote: "0", error: "Invalid amount" };
    }

    const amountsOut = await readClient.readContract({
      address: UNISWAP_ROUTER_ADDRESS,
      abi: UniswapAbi,
      functionName: 'getAmountsOut',
      args: [amountIn, [WETH_ADDRESS, PIXOTCHI_TOKEN_ADDRESS]],
    }) as bigint[];
    
    if (!amountsOut || amountsOut.length < 2 || amountsOut[1] <= BigInt(0)) {
      return { quote: "0", error: "No liquidity available" };
    }
    
    return { quote: formatUnits(amountsOut[1], 18) };
  } catch (error: any) {
    // Log error details for debugging (only in development)
    if (process.env.NODE_ENV === 'development') {
      console.error('Error fetching swap quote:', error);
    }
    
    // Provide user-friendly error messages
    let errorMessage = "Unable to get quote";
    if (error?.message?.includes('insufficient reserves')) {
      errorMessage = "Insufficient liquidity";
    } else if (error?.message?.includes('network')) {
      errorMessage = "Network error, please try again";
    } else if (error?.message?.includes('timeout')) {
      errorMessage = "Request timeout, please try again";
    }
    
    return { quote: "0", error: errorMessage };
  }
};

// Execute swap
export const executeSwap = async (walletClient: WalletClient, ethAmount: string): Promise<boolean> => {
  return retryWithBackoff(async () => {
    if (!walletClient.account) throw new Error('No account connected');
    
    const readClient = getReadClient();
    const amountIn = parseUnits(ethAmount, 18);

    const amountsOut = await readClient.readContract({
      address: UNISWAP_ROUTER_ADDRESS,
      abi: UniswapAbi,
      functionName: 'getAmountsOut',
      args: [amountIn, [WETH_ADDRESS, PIXOTCHI_TOKEN_ADDRESS]],
    }) as bigint[];

    const amountOutMin = amountsOut[1] * BigInt(95) / BigInt(100); // 5% slippage
    const deadline = Math.floor(Date.now() / 1000) + 60 * 5; // 5 minutes from now

    const hash = await walletClient.writeContract({
      address: UNISWAP_ROUTER_ADDRESS,
      abi: UniswapAbi,
      functionName: 'swapExactETHForTokens',
      args: [
        amountOutMin,
        [WETH_ADDRESS, PIXOTCHI_TOKEN_ADDRESS],
        walletClient.account.address,
        BigInt(deadline)
      ],
      value: amountIn,
      account: walletClient.account,
      chain: base,
    });

    const receipt = await readClient.waitForTransactionReceipt({ hash });
    return receipt.status === 'success';
  });
};

// -------------------- Fence HELPERS --------------------

export type FenceV2Config = {
  pricePerDay: bigint;
  minDurationDays: number;
  maxDurationDays: number;
};

const normalizeFenceV2Config = (result: any): FenceV2Config => {
  const priceRaw = result?.pricePerDay ?? result?.[0] ?? 0;
  const minRaw = result?.minDurationDays ?? result?.minDays ?? result?.[1] ?? 0;
  const maxRaw = result?.maxDurationDays ?? result?.maxDays ?? result?.[2] ?? 0;
  return {
    pricePerDay: BigInt(priceRaw ?? 0),
    minDurationDays: Number(minRaw ?? 0),
    maxDurationDays: Number(maxRaw ?? 0),
  };
};

const computeFenceV2State = (effectUntilRaw: any, isActiveRaw: any, v1ActiveRaw: any): FenceV2State | null => {
  const effectUntilNumber = Number(effectUntilRaw ?? 0);
  const isActive = Boolean(isActiveRaw);
  const v1Active = Boolean(v1ActiveRaw);
  const nowSec = Math.floor(Date.now() / 1000);
  const secondsRemaining = effectUntilNumber > 0 ? Math.max(0, effectUntilNumber - nowSec) : 0;
  const totalDaysPurchased = secondsRemaining > 0 ? Math.ceil(secondsRemaining / (24 * 60 * 60)) : 0;

  return {
    activeUntil: effectUntilNumber,
    isActive,
    v1Active,
    totalDaysPurchased,
    quotedDays: null,
    isMirroringV1: false,
  };
};

type PublicClientType = PublicClient;

const getFenceV2StatesInternal = async (
  plantIds: number[],
  client: PublicClientType,
): Promise<Record<number, FenceV2State | null>> => {
  if (plantIds.length === 0) return {};

  // Use fenceV2GetPurchaseStats which returns everything we need in one call
  const calls = plantIds.map((id) => ({
    address: FENCE_V2_EXTENSION_ADDRESS,
    abi: fenceV2Abi,
    functionName: 'fenceV2GetPurchaseStats' as const,
    args: [BigInt(id)],
  }));

  const responses = await retryWithBackoff(async () => {
    return client.multicall({ contracts: calls, allowFailure: true });
  });

  const result: Record<number, FenceV2State | null> = {};
  for (let index = 0; index < plantIds.length; index++) {
    const stats = responses[index]?.result as any;
    if (stats) {
      const effectUntilRes = stats[1]; // activeUntil
      const isActiveRes = stats[1] && Number(stats[1]) > Math.floor(Date.now() / 1000); // Check if activeUntil is in future
      const hasV1Res = stats[3]; // fenceV1Active
      result[plantIds[index]] = computeFenceV2State(effectUntilRes, isActiveRes, hasV1Res);
    } else {
      result[plantIds[index]] = null;
    }
  }
  return result;
};

export const getFenceV2Config = async (): Promise<FenceV2Config | null> => {
  const readClient = getReadClient();
  try {
    const raw = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: FENCE_V2_EXTENSION_ADDRESS,
        abi: fenceV2Abi,
        functionName: 'fenceV2GetConfig',
      });
    });
    return normalizeFenceV2Config(raw);
  } catch (error) {
    console.warn('getFenceV2Config failed:', error);
    return null;
  }
};

export const quoteFenceV2 = async (days: number): Promise<bigint> => {
  if (!Number.isFinite(days) || days <= 0) return BigInt(0);
  const readClient = getReadClient();
  try {
    const quote = await retryWithBackoff(async () => {
      return readClient.readContract({
        address: FENCE_V2_EXTENSION_ADDRESS,
        abi: fenceV2Abi,
        functionName: 'fenceV2Quote',
        args: [BigInt(days)],
      });
    });
    if (typeof quote === 'bigint') return quote;
    const numeric = (quote ?? 0) as number | string | bigint;
    return BigInt(numeric);
  } catch (error) {
    console.warn('quoteFenceV2 failed:', error);
    return BigInt(0);
  }
};

export const buildFenceV2PurchaseCall = (plantId: number, days: number): { address: `0x${string}`; abi: typeof fenceV2Abi; functionName: 'fenceV2Purchase'; args: [bigint, bigint] } => {
  return {
    address: FENCE_V2_EXTENSION_ADDRESS,
    abi: fenceV2Abi,
    functionName: 'fenceV2Purchase',
    args: [BigInt(plantId), BigInt(days)],
  };
};

export const buyFenceV2 = async (walletClient: WalletClient, plantId: number, days: number): Promise<boolean> => {
  if (!walletClient.account) throw new Error('No account connected');
  return retryWithBackoff(async () => {
    const hash = await walletClient.writeContract({
      address: FENCE_V2_EXTENSION_ADDRESS,
      abi: fenceV2Abi,
      functionName: 'fenceV2Purchase',
      args: [BigInt(plantId), BigInt(days)],
      account: walletClient.account!,
      chain: base,
    });
    const writeClient = getWriteClient();
    const receipt = await writeClient.waitForTransactionReceipt({ hash });
    return receipt.status === 'success';
  });
};

export const setFenceV2PricePerDay = async (walletClient: WalletClient, pricePerDay: bigint): Promise<boolean> => {
  if (!walletClient.account) throw new Error('No account connected');
  return retryWithBackoff(async () => {
    const hash = await walletClient.writeContract({
      address: FENCE_V2_EXTENSION_ADDRESS,
      abi: fenceV2Abi,
      functionName: 'fenceV2SetPricePerDay',
      args: [pricePerDay],
      account: walletClient.account!,
      chain: base,
    });
    const writeClient = getWriteClient();
    const receipt = await writeClient.waitForTransactionReceipt({ hash });
    return receipt.status === 'success';
  });
};

const attachFenceV2State = async (
  client: PublicClientType,
  plants: any[],
): Promise<Record<number, FenceV2State | null>> => {
  try {
    const ids = plants
      .map((plant) => Number(plant?.id ?? plant?.[0] ?? 0))
      .filter((id) => Number.isFinite(id) && id >= 0);
    return await getFenceV2StatesInternal(ids, client);
  } catch (error) {
    console.warn('attachFenceV2State failed:', error);
    return {};
  }
};

// LEAF token balance (returns raw bigint for precision)
export const getLeafBalance = async (address: string): Promise<bigint> => {
  const readClient = getReadClient();
  
  return retryWithBackoff(async () => {
    const balance = await readClient.readContract({
      address: LEAF_CONTRACT_ADDRESS,
      abi: leafAbi,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });
    
    return balance as bigint;
  });
};

// Building Management Functions
export const getVillageBuildingsByLandId = async (landId: bigint): Promise<any[]> => {
  const readClient = getReadClient();
  
  return retryWithBackoff(async () => {
    const buildings = await readClient.readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'villageGetVillageBuildingsByLandId',
      args: [landId],
    });
    
    return buildings as any[];
  });
};

export const getTownBuildingsByLandId = async (landId: bigint): Promise<any[]> => {
  const readClient = getReadClient();
  
  return retryWithBackoff(async () => {
    const buildings = await readClient.readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'townGetBuildingsByLandId',
      args: [landId],
    });
    
    return buildings as any[];
  });
};

export interface LandBuildingsBatchResult {
  landId: bigint;
  villageBuildings: any[];
  townBuildings: any[];
}

export const getLandBuildingsBatch = async (
  landIds: bigint[],
  options: { chunkSize?: number } = {},
): Promise<LandBuildingsBatchResult[]> => {
  if (landIds.length === 0) return [];

  const { chunkSize = 15 } = options;
  const readClient = getReadClient();
  const results: LandBuildingsBatchResult[] = [];

  for (let i = 0; i < landIds.length; i += chunkSize) {
    const chunk = landIds.slice(i, i + chunkSize);
    const contracts = chunk.flatMap((landId) => [
      {
        address: LAND_CONTRACT_ADDRESS,
        abi: landAbi,
        functionName: 'villageGetVillageBuildingsByLandId' as const,
        args: [landId],
      },
      {
        address: LAND_CONTRACT_ADDRESS,
        abi: landAbi,
        functionName: 'townGetBuildingsByLandId' as const,
        args: [landId],
      },
    ]);

    const chunkResults = await retryWithBackoff(async () => {
      return readClient.multicall({
        allowFailure: true,
        contracts,
      });
    });

    for (let index = 0; index < chunk.length; index++) {
      const landId = chunk[index];
      const villageEntry = chunkResults[index * 2];
      const townEntry = chunkResults[index * 2 + 1];

      const villageBuildings = Array.isArray(villageEntry?.result)
        ? (villageEntry.result as any[])
        : [];
      const townBuildings = Array.isArray(townEntry?.result)
        ? (townEntry.result as any[])
        : [];

      results.push({
        landId,
        villageBuildings,
        townBuildings,
      });
    }
  }

  return results;
};

// Quest slots
export type QuestSlot = {
  difficulty: number;
  startBlock: bigint;
  endBlock: bigint;
  pseudoRndBlock: bigint;
  coolDownBlock: bigint;
};

export const getQuestSlotsByLandId = async (landId: bigint): Promise<QuestSlot[]> => {
  const readClient = getReadClient();
  return retryWithBackoff(async () => {
    const slots = await readClient.readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'questGetByLandId',
      args: [landId],
    });
    // Ensure array of normalized objects
    return (slots as any[]).map((s: any) => ({
      difficulty: Number(s.difficulty ?? s[0] ?? 0),
      startBlock: BigInt(s.startBlock ?? s[1] ?? 0),
      endBlock: BigInt(s.endBlock ?? s[2] ?? 0),
      pseudoRndBlock: BigInt(s.pseudoRndBlock ?? s[3] ?? 0),
      coolDownBlock: BigInt(s.coolDownBlock ?? s[4] ?? 0),
    })) as QuestSlot[];
  });
};

// Village Building Upgrade Functions
export const upgradeVillageWithLeaf = async (walletClient: WalletClient, landId: bigint, buildingId: number): Promise<string> => {
  if (!walletClient.account) throw new Error('No account connected');
  
  const hash = await walletClient.writeContract({
    address: LAND_CONTRACT_ADDRESS,
    abi: landAbi,
    functionName: 'villageUpgradeWithLeaf',
    args: [landId, buildingId],
    account: walletClient.account,
    chain: base,
  });
  
  return hash;
};

export const speedUpVillageWithSeed = async (walletClient: WalletClient, landId: bigint, buildingId: number): Promise<string> => {
  if (!walletClient.account) throw new Error('No account connected');
  
  const hash = await walletClient.writeContract({
    address: LAND_CONTRACT_ADDRESS,
    abi: landAbi,
    functionName: 'villageSpeedUpWithSeed',
    args: [landId, buildingId],
    account: walletClient.account,
    chain: base,
  });
  
  return hash;
};

// Town Building Upgrade Functions
export const upgradeTownWithLeaf = async (walletClient: WalletClient, landId: bigint, buildingId: number): Promise<string> => {
  if (!walletClient.account) throw new Error('No account connected');
  
  const hash = await walletClient.writeContract({
    address: LAND_CONTRACT_ADDRESS,
    abi: landAbi,
    functionName: 'townUpgradeWithLeaf',
    args: [landId, buildingId],
    account: walletClient.account,
    chain: base,
  });
  
  return hash;
};

export const speedUpTownWithSeed = async (walletClient: WalletClient, landId: bigint, buildingId: number): Promise<string> => {
  if (!walletClient.account) throw new Error('No account connected');
  
  const hash = await walletClient.writeContract({
    address: LAND_CONTRACT_ADDRESS,
    abi: landAbi,
    functionName: 'townSpeedUpWithSeed',
    args: [landId, buildingId],
    account: walletClient.account,
    chain: base,
  });
  
  return hash;
};

// Village Production Claim Function
export const claimVillageProduction = async (walletClient: WalletClient, landId: bigint, buildingId: number): Promise<string> => {
  if (!walletClient.account) throw new Error('No account connected');
  
  const hash = await walletClient.writeContract({
    address: LAND_CONTRACT_ADDRESS,
    abi: landAbi,
    functionName: 'villageClaimProduction',
    args: [landId, buildingId],
    account: walletClient.account,
    chain: base,
  });
  
  return hash;
};

// Leaderboard functions
export const getAliveTokenIds = async (): Promise<number[]> => {
  const readClient = getReadClient();
  
  return retryWithBackoff(async () => {
    const tokenIds = await readClient.readContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: 'airdropGetAliveAndDeadTokenIds',
    }) as bigint[];

    return tokenIds.map(id => Number(id));
  });
};

export const getPlantsInfoExtended = async (tokenIds: number[]): Promise<Plant[]> => {
  const readClient = getReadClient();
  
  return retryWithBackoff(async () => {
    const plants = await readClient.readContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: 'getPlantsInfoExtended',
      args: [tokenIds.map(id => BigInt(id))],
    }) as any[];

    const fenceV2Map = await attachFenceV2State(readClient, plants);

    return plants.map((plant: any) => {
      const plantId = Number(plant.id);
      const extensions = plant.extensions || [];
    const fenceV1EffectUntil = getMaxFenceEffectUntil(extensions);
    const baseFenceV2 = fenceV2Map[plantId] ?? null;
    const isMirroring = baseFenceV2?.isActive && fenceV1EffectUntil > 0 && approxTimestampEqual(fenceV1EffectUntil, Number(baseFenceV2?.activeUntil ?? 0));
    const fenceV2 = baseFenceV2
      ? {
          ...baseFenceV2,
          v1Active: isMirroring ? false : baseFenceV2.v1Active,
          isMirroringV1: Boolean(isMirroring),
        }
      : null;

      return {
        id: plantId,
        name: plant.name || '',
        score: Number(plant.score),
        status: Number(plant.status),
        rewards: Number(plant.rewards),
        level: Number(plant.level),
        timeUntilStarving: Number(plant.timeUntilStarving),
        stars: Number(plant.stars),
        strain: Number(plant.strain),
        timePlantBorn: plant.timePlantBorn ? plant.timePlantBorn.toString() : '0',
        lastAttackUsed: plant.lastAttackUsed ? plant.lastAttackUsed.toString() : '0',
        lastAttacked: plant.lastAttacked ? plant.lastAttacked.toString() : '0',
        statusStr: plant.statusStr || '',
        owner: plant.owner,
        extensions,
        fenceV2,
      };
    });
  });
}; 

// Fetch Lands leaderboard across full supply range
export type LandLeaderboardEntry = { landId: number; experiencePoints: bigint; name: string };

export const getLandLeaderboard = async (): Promise<LandLeaderboardEntry[]> => {
  const readClient = getReadClient();
  return retryWithBackoff(async () => {
    // Determine total supply to cover full range
    const totalSupply = await readClient.readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'totalSupply',
    }) as bigint;

    const leaderboard = await readClient.readContract({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'getLeaderboard',
      args: [BigInt(0), totalSupply],
    }) as any[];

    return (leaderboard || []).map((entry: any) => ({
      landId: Number(entry.landId ?? entry[0] ?? 0),
      experiencePoints: BigInt(entry.experiencePoints ?? entry[1] ?? 0),
      name: String(entry.name ?? entry[2] ?? ''),
    }));
  });
};

// -------------------- ROUTER-BASED BULK TRANSFER --------------------

export const routerBatchTransfer = async (
  walletClient: WalletClient,
  toAddress: string,
  plantIds: number[],
  landIds: bigint[],
): Promise<{ hash: `0x${string}`; success: boolean }> => {
  if (!walletClient?.account) throw new Error('No account connected');
  if (!BATCH_ROUTER_ADDRESS) throw new Error('Batch router not configured');
  const to = getAddress(toAddress);

  // Build arguments
  const hasPlants = plantIds.length > 0;
  const hasLands = landIds.length > 0;

  let hash: `0x${string}`;
  if (hasPlants && hasLands) {
    // Single tx for both collections
    const tokens = [PIXOTCHI_NFT_ADDRESS, LAND_CONTRACT_ADDRESS] as const;
    const tokenIdsPerToken = [
      plantIds.map((id) => BigInt(id)),
      landIds
    ];
    hash = await walletClient.writeContract({
      address: BATCH_ROUTER_ADDRESS,
      abi: BATCH_ROUTER_ABI,
      functionName: 'batchTransfer721Multi',
      args: [tokens as unknown as `0x${string}`[], to, tokenIdsPerToken],
      account: walletClient.account,
      chain: base,
    });
  } else if (hasPlants) {
    hash = await walletClient.writeContract({
      address: BATCH_ROUTER_ADDRESS,
      abi: BATCH_ROUTER_ABI,
      functionName: 'batchTransfer721',
      args: [PIXOTCHI_NFT_ADDRESS, to, plantIds.map((id) => BigInt(id))],
      account: walletClient.account,
      chain: base,
    });
  } else if (hasLands) {
    hash = await walletClient.writeContract({
      address: BATCH_ROUTER_ADDRESS,
      abi: BATCH_ROUTER_ABI,
      functionName: 'batchTransfer721',
      args: [LAND_CONTRACT_ADDRESS, to, landIds],
      account: walletClient.account,
      chain: base,
    });
  } else {
    throw new Error('No assets to transfer');
  }

  const writeClient = getWriteClient();
  const receipt = await writeClient.waitForTransactionReceipt({ hash });
  return { hash, success: receipt.status === 'success' };
};