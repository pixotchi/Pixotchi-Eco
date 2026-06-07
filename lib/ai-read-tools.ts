import 'server-only';

import { tool } from 'ai';
import { decodeEventLog, formatUnits, getAddress, isAddress, parseAbiItem, parseUnits, type Hex } from 'viem';
import { z } from 'zod';
import {
  barracksGetConfigV2,
  barracksGetEligibleAttackableLandIds,
  barracksGetLandStateV2,
  barracksPreviewRaidV2,
  BATCH_ROUTER_ADDRESS,
  BOX_GAME_ABI,
  blackjackGetActions,
  blackjackGetConfig,
  blackjackGetGameSnapshot,
  blackjackGetGameToken,
  blackjackGetStats,
  blackjackGetTokenConfig,
  blackjackIsAvailable,
  casinoGetActiveBetV2,
  casinoGetBuildingConfig,
  casinoGetConfig,
  casinoGetStats,
  casinoGetSupportedTokens,
  casinoGetTokenConfig,
  CREATOR_TOKEN_ADDRESS,
  CRYPTICPOET_TOKEN_ADDRESS,
  getAliveTokenIds,
  getAllGardenItems,
  getFenceV2Config,
  getLandBuildingsBatch,
  getLandLeaderboard,
  getLandMintPrice,
  getLandsByIds,
  getLandsByOwner,
  getLeafBalance,
  getPlantsByOwner,
  getPlantsInfoExtended,
  KILL_COOLDOWN_ABI,
  getQuestSlotsByLandId,
  getRevivePrice,
  getShopItems,
  getStakeComposite,
  getStrainInfo,
  getStakeAllowance,
  getTokenBalance,
  getTokenBalanceForToken,
  JESSE_TOKEN_ADDRESS,
  LAND_CONTRACT_ADDRESS,
  LEAF_CONTRACT_ADDRESS,
  PIXOTCHI_NFT_ADDRESS,
  PIXOTCHI_TOKEN_ADDRESS,
  quoteFenceV2,
  SPIN_GAME_ABI,
  STAKE_CONTRACT_ADDRESS,
  UNISWAP_ROUTER_ADDRESS,
  USDC_ADDRESS,
  WETH_ADDRESS,
  ZERO_ADDRESS,
  type LandLeaderboardEntry,
} from './contracts';
import { getAIReadClient, getAIRpcSourceLabel } from './ai-rpc';
import { getCachedAllActivity, getCachedMyActivity } from './activity-service';
import { getLeaderboards, getMissionDay, getMissionScore, getStreak } from './gamification-service';
import { getStakeLeaderboard } from './stake-leaderboard-service';
import { getSwapQuoteForUserPair } from './swap/engine';
import { getSwapToken, isUserSwapTokenId, USER_SWAP_TOKEN_IDS } from './swap/constants';
import type { UserSwapTokenId } from './swap/types';
import { GAME_ACTION_TOPICS, getGameActionGuide } from './ai-action-guide';
import { fetchSeedMarketPulse, SEED_PAIR_DEXSCREENER_URL } from './seed-market';
import { getAllPixotchiTokenInfo, getPixotchiTokenInfo } from './pixotchi-token-info';
import { fetchIndexerGraphQL } from './indexer-client';
import { PLANT_STRAINS_BY_ID, TOWN_BUILDING_NAMES, VILLAGE_BUILDING_NAMES } from './constants';
import { CLIENT_ENV } from './env-config';
import { redis } from './redis';
import { getCachedStatusSnapshot } from './status-checks';
import { getBridgeConfig, getPixotchiSolanaConfig, isSolanaEnabled, validateSolanaConfig } from './solana-constants';
import { getTwinAddressInfo, isTwinSetup } from './solana-twin';
import { getFenceStatus } from './utils';
import { VERIFY_CLAIM_LEAF_BONUS_LABEL, VERIFY_CLAIM_SEED_BONUS_AMOUNT, VERIFY_CLAIM_SEED_BONUS_LABEL } from './verify-claim-config';
import { landAbi } from '../public/abi/pixotchi-v3-abi';
import type { PixotchiReadClient } from './contracts';
import type { ActivityEvent, BarracksLandStateV2, BarracksRaidPreviewV2, BarracksRaidReportV2, BuildingData, Land, NormalizedOnchainActivity, Plant } from './types';

type ReadOnlyToolContext = {
  sourceAddress?: string | null;
  userAddress: string;
};

type ToolFreshness = {
  blockNumber?: string;
  cache?: string;
  fetchedAt: string;
};

type ToolResult<T> = {
  blockNumber?: string;
  cache?: string;
  confidence: 'high' | 'medium' | 'low';
  data?: T;
  error?: string;
  fetchedAt: string;
  freshness: ToolFreshness;
  limitations: string[];
  source: string;
  status: 'ok' | 'error';
  truncated?: boolean;
};

const TOOL_RESULT_OUTPUT_SCHEMA = z.object({
  blockNumber: z.string().optional(),
  cache: z.string().optional(),
  confidence: z.enum(['high', 'medium', 'low']),
  data: z.unknown().optional(),
  error: z.string().optional(),
  fetchedAt: z.string(),
  freshness: z.object({
    blockNumber: z.string().optional(),
    cache: z.string().optional(),
    fetchedAt: z.string(),
  }),
  limitations: z.array(z.string()),
  source: z.string(),
  status: z.enum(['ok', 'error']),
  truncated: z.boolean().optional(),
});

const READ_TOOL_DEFAULTS = {
  outputSchema: TOOL_RESULT_OUTPUT_SCHEMA,
  strict: true,
} as const;

const ADDRESS_INPUT = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .optional()
  .describe('Optional public wallet address. Omit this to use the authenticated user.');
const SOLANA_ADDRESS_INPUT = z
  .string()
  .trim()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
  .optional()
  .describe('Optional public Solana wallet address. Omit this to use the authenticated Solana source wallet when available.');

const USER_SWAP_TOKEN_ENUM = z.enum(USER_SWAP_TOKEN_IDS);
const GAME_ACTION_TOPIC_ENUM = z.enum(GAME_ACTION_TOPICS);
const PIXOTCHI_TOKEN_INFO_ENUM = z.enum(['all', 'seed', 'leaf', 'pixotchi']);

const TOWN_BUILDING_LABELS: Record<number, string> = {
  ...TOWN_BUILDING_NAMES,
  6: 'Casino',
  8: 'Barracks',
};

const MAX_BUILDING_AGGREGATE_LANDS = 100;
const AI_LAND_PRODUCTION_AUDIT_MAX_LANDS = Number.parseInt(process.env.AI_LAND_PRODUCTION_AUDIT_MAX_LANDS || '', 10) || 250;
const AI_MARKETPLACE_ORDER_SCAN_LIMIT = Number.parseInt(process.env.AI_MARKETPLACE_ORDER_SCAN_LIMIT || '', 10) || 250;
const AI_CASINO_STATUS_MAX_LANDS = Number.parseInt(process.env.AI_CASINO_STATUS_MAX_LANDS || '', 10) || 40;
const PLANT_ATTACK_ATTACKER_COOLDOWN_SECONDS = 30 * 60;
const PLANT_ATTACK_TARGET_COOLDOWN_SECONDS = 60 * 60;
const AI_COMBAT_ACTIVITY_MAX_HOURS = Number.parseInt(process.env.AI_COMBAT_ACTIVITY_MAX_HOURS || '', 10) || 31 * 24;
const AI_WALLET_ACTIVITY_BLOCK_RANGE = Number.parseInt(process.env.AI_WALLET_ACTIVITY_BLOCK_RANGE || '', 10) || 150_000;
const AI_WALLET_ACTIVITY_LOG_LIMIT = Number.parseInt(process.env.AI_WALLET_ACTIVITY_LOG_LIMIT || '', 10) || 60;
const AI_WALLET_ACTIVITY_LOG_CHUNK_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.AI_WALLET_ACTIVITY_LOG_CHUNK_CONCURRENCY || '', 10) || 4,
);
const AI_PLANT_CARE_AUDIT_MAX_PLANTS = Number.parseInt(process.env.AI_PLANT_CARE_AUDIT_MAX_PLANTS || '', 10) || 100;
const AI_ARCADE_STATUS_MAX_PLANTS = Number.parseInt(process.env.AI_ARCADE_STATUS_MAX_PLANTS || '', 10) || 30;
const AI_QUEST_READINESS_MAX_LANDS = Number.parseInt(process.env.AI_QUEST_READINESS_MAX_LANDS || '', 10) || 60;
const AI_LAND_RAID_REPORT_MAX_LANDS = Number.parseInt(process.env.AI_LAND_RAID_REPORT_MAX_LANDS || '', 10) || 60;
const AI_BLACKJACK_ACTION_MAX_LANDS = Number.parseInt(process.env.AI_BLACKJACK_ACTION_MAX_LANDS || '', 10) || 40;
const QUEST_REWARDS_WALLET = getAddress('0xd528071FB9dC9715ea8da44e2c4433EAc017d1DB');
const MIN_QUEST_REWARDS_SEED_BALANCE = parseUnits('300', 18);
const QUEST_BLOCK_SECONDS = 2;
function buildCombatActivityQuery(direction: 'all' | 'incoming' | 'outgoing') {
  const plantWhere = direction === 'incoming'
    ? 'attacker_not_in: $plantIds, OR: [{ winner_in: $plantIds }, { loser_in: $plantIds }]'
    : direction === 'outgoing'
      ? 'attacker_in: $plantIds'
      : 'OR: [{ attacker_in: $plantIds }, { winner_in: $plantIds }, { loser_in: $plantIds }]';
  const landWhere = direction === 'incoming'
    ? 'defenderLandId_in: $landIds'
    : direction === 'outgoing'
      ? 'attackerLandId_in: $landIds'
      : 'OR: [{ attackerLandId_in: $landIds }, { defenderLandId_in: $landIds }]';

  return `
    query GetCombatActivity($plantIds: [BigInt!], $landIds: [BigInt!], $fromTimestamp: BigInt!, $toTimestamp: BigInt!, $limit: Int!) {
    attacks(
      orderBy: "timestamp",
      orderDirection: "desc",
      limit: $limit,
      where: {
        timestamp_gte: $fromTimestamp,
        timestamp_lte: $toTimestamp,
        ${plantWhere}
      }
    ) {
      items {
        __typename
        id
        timestamp
        attacker
        winner
        loser
        attackerName
        winnerName
        loserName
        scoresWon
      }
    }
    barracksRaidEvents(
      orderBy: "timestamp",
      orderDirection: "desc",
      limit: $limit,
      where: {
        timestamp_gte: $fromTimestamp,
        timestamp_lte: $toTimestamp,
        ${landWhere}
      }
    ) {
      items {
        __typename
        id
        timestamp
        raidId
        attackerLandId
        defenderLandId
        attackerWon
        blockHeight
      }
    }
  }`;
}
const ERC20_TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const ERC721_TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
const ERC20_ALLOWANCE_ABI = [
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
const TX_HASH_INPUT = z.string().trim().regex(/^0x[a-fA-F0-9]{64}$/).describe('Base transaction hash.');

type KnownBalanceToken = {
  address?: `0x${string}`;
  assetType: 'native' | 'token';
  decimals: number;
  id: string;
  name: string;
  symbol: string;
};

type KnownTransferContract = {
  address: `0x${string}`;
  activityKind: string;
  assetType: 'plant' | 'land' | 'token';
  decimals: number;
  id: string;
  name: string;
  standard: 'erc20' | 'erc721';
  symbol: string;
};

const KNOWN_BALANCE_TOKENS: KnownBalanceToken[] = [
  { assetType: 'native', decimals: 18, id: 'eth', name: 'Ether on Base', symbol: 'ETH' },
  { address: PIXOTCHI_TOKEN_ADDRESS, assetType: 'token', decimals: 18, id: 'seed', name: 'Pixotchi SEED', symbol: 'SEED' },
  { address: LEAF_CONTRACT_ADDRESS, assetType: 'token', decimals: 18, id: 'leaf', name: 'Pixotchi LEAF', symbol: 'LEAF' },
  { address: CREATOR_TOKEN_ADDRESS, assetType: 'token', decimals: 18, id: 'pixotchi', name: 'Pixotchi creator token', symbol: 'PIXOTCHI' },
  { address: JESSE_TOKEN_ADDRESS, assetType: 'token', decimals: 18, id: 'jesse', name: 'JESSE', symbol: 'JESSE' },
  { address: USDC_ADDRESS, assetType: 'token', decimals: 6, id: 'usdc', name: 'USD Coin on Base', symbol: 'USDC' },
];

const KNOWN_TRANSFER_CONTRACTS: KnownTransferContract[] = [
  { address: PIXOTCHI_NFT_ADDRESS, activityKind: 'plant_transfer', assetType: 'plant', decimals: 0, id: 'plant_nft', name: 'Pixotchi Plant NFT', standard: 'erc721', symbol: 'PLANT' },
  { address: LAND_CONTRACT_ADDRESS, activityKind: 'land_transfer', assetType: 'land', decimals: 0, id: 'land_nft', name: 'Pixotchi Land NFT', standard: 'erc721', symbol: 'LAND' },
  { address: PIXOTCHI_TOKEN_ADDRESS, activityKind: 'token_transfer', assetType: 'token', decimals: 18, id: 'seed', name: 'Pixotchi SEED', standard: 'erc20', symbol: 'SEED' },
  { address: LEAF_CONTRACT_ADDRESS, activityKind: 'token_transfer', assetType: 'token', decimals: 18, id: 'leaf', name: 'Pixotchi LEAF', standard: 'erc20', symbol: 'LEAF' },
  { address: CREATOR_TOKEN_ADDRESS, activityKind: 'token_transfer', assetType: 'token', decimals: 18, id: 'pixotchi', name: 'Pixotchi creator token', standard: 'erc20', symbol: 'PIXOTCHI' },
  { address: JESSE_TOKEN_ADDRESS, activityKind: 'token_transfer', assetType: 'token', decimals: 18, id: 'jesse', name: 'JESSE', standard: 'erc20', symbol: 'JESSE' },
  { address: USDC_ADDRESS, activityKind: 'token_transfer', assetType: 'token', decimals: 6, id: 'usdc', name: 'USD Coin on Base', standard: 'erc20', symbol: 'USDC' },
];

function getTargetAddress(input: string | undefined, fallback: string): `0x${string}` {
  const candidate = input?.trim() || fallback;
  if (!isAddress(candidate)) {
    throw new Error('Invalid wallet address.');
  }
  return getAddress(candidate);
}

function formatToken(raw: bigint | number | string | undefined, decimals = 18): string {
  try {
    if (typeof raw === 'bigint') return formatUnits(raw, decimals);
    if (typeof raw === 'number') return String(raw);
    if (typeof raw === 'string' && raw.trim()) return formatUnits(BigInt(raw), decimals);
  } catch {
    return String(raw ?? '0');
  }
  return '0';
}

const TOKEN_SYMBOL_BY_ADDRESS: Record<string, string> = {
  [PIXOTCHI_TOKEN_ADDRESS.toLowerCase()]: 'SEED',
  [LEAF_CONTRACT_ADDRESS.toLowerCase()]: 'LEAF',
  [CREATOR_TOKEN_ADDRESS.toLowerCase()]: 'PIXOTCHI',
  [JESSE_TOKEN_ADDRESS.toLowerCase()]: 'JESSE',
  [CRYPTICPOET_TOKEN_ADDRESS.toLowerCase()]: 'CRYPTICPOET',
  [getBridgeConfig().base.wrappedSOL.toLowerCase()]: 'wSOL',
  [WETH_ADDRESS.toLowerCase()]: 'WETH',
  [USDC_ADDRESS.toLowerCase()]: 'USDC',
};

const TOKEN_DECIMALS_BY_ADDRESS: Record<string, number> = {
  [getBridgeConfig().base.wrappedSOL.toLowerCase()]: 9,
  [USDC_ADDRESS.toLowerCase()]: 6,
};

function compactTokenAmount(amount: string): string {
  if (!amount.includes('.')) {
    return amount;
  }

  const compact = amount.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return compact || '0';
}

function shortenTokenAddress(address: string | undefined): string {
  if (!address) {
    return 'unknown token';
  }

  return isAddress(address)
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : address;
}

export function getAIPriceTokenSymbol(tokenAddress: string | undefined): string {
  if (!tokenAddress) {
    return 'SEED';
  }

  const normalized = isAddress(tokenAddress)
    ? getAddress(tokenAddress).toLowerCase()
    : tokenAddress.toLowerCase();

  return TOKEN_SYMBOL_BY_ADDRESS[normalized] || shortenTokenAddress(tokenAddress);
}

function getKnownTokenDecimals(tokenAddress: string | undefined, fallback = 18): number {
  if (!tokenAddress || !isAddress(tokenAddress)) {
    return fallback;
  }

  return TOKEN_DECIMALS_BY_ADDRESS[getAddress(tokenAddress).toLowerCase()] ?? fallback;
}

function formatKnownTokenAmount(
  rawAmount: bigint | number | string | undefined,
  tokenAddress: string | undefined,
  fallbackDecimals = 18,
): string {
  return compactTokenAmount(formatToken(rawAmount, getKnownTokenDecimals(tokenAddress, fallbackDecimals)));
}

function safeJsonParse(value: UntypedValue): UntypedValue {
  if (!value || typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isSeedToken(tokenAddress: string | undefined): boolean {
  return Boolean(tokenAddress && isAddress(tokenAddress) && getAddress(tokenAddress).toLowerCase() === PIXOTCHI_TOKEN_ADDRESS.toLowerCase());
}

function formatPriceFields(
  rawAmount: bigint | number | string | undefined,
  tokenAddress: string | undefined,
  options: { decimals?: number; suffix?: string } = {},
) {
  const priceAmount = compactTokenAmount(formatToken(rawAmount, options.decimals ?? 18));
  const priceTokenAddress = tokenAddress && isAddress(tokenAddress)
    ? getAddress(tokenAddress)
    : tokenAddress;
  const priceTokenSymbol = getAIPriceTokenSymbol(priceTokenAddress);

  return {
    priceAmount,
    priceDisplay: `${priceAmount} ${priceTokenSymbol}${options.suffix || ''}`,
    priceTokenAddress,
    priceTokenSymbol,
  };
}

function formatPts(raw: bigint | number | string | undefined): string {
  return formatToken(raw, 12);
}

function formatSeconds(raw: bigint | number | string | undefined): string {
  if (typeof raw === 'bigint') return raw.toString();
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : '0';
  if (typeof raw === 'string' && raw.trim()) return raw;
  return '0';
}

function toNumber(value: bigint | number | string | undefined, decimals = 0): number {
  if (typeof value === 'bigint') {
    return decimals > 0 ? Number(formatUnits(value, decimals)) : Number(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return Number.isFinite(value) ? Number(value) : 0;
}

function statusLabel(status: number, statusStr?: string): string {
  if (statusStr) return statusStr;
  switch (status) {
    case 0:
      return 'Great';
    case 1:
      return 'Okay';
    case 2:
      return 'Dry';
    case 3:
      return 'Dying';
    case 4:
      return 'Dead';
    default:
      return `Unknown (${status})`;
  }
}

function jsonSafe(value: UntypedValue): UntypedValue {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    const output: Record<string, UntypedValue> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (typeof nested !== 'function' && typeof nested !== 'undefined') {
        output[key] = jsonSafe(nested);
      }
    }
    return output;
  }
  return value;
}

async function getBlockNumberSafe(readClient: PixotchiReadClient): Promise<string | undefined> {
  try {
    return (await readClient.getBlockNumber()).toString();
  } catch {
    return undefined;
  }
}

function errorMessage(error: UntypedValue): string {
  return error instanceof Error ? error.message : 'Unknown read-only tool error.';
}

async function withToolResult<T>(
  toolName: string,
  source: string,
  options: {
    cache?: string;
    confidence?: 'high' | 'medium' | 'low';
    includeBlock?: boolean;
    limitations?: string[];
    truncated?: boolean;
  },
  run: () => Promise<T>,
  readClient: PixotchiReadClient,
): Promise<ToolResult<T>> {
  const startedAt = Date.now();
  const fetchedAt = new Date().toISOString();
  const blockNumber = options.includeBlock === false ? undefined : await getBlockNumberSafe(readClient);

  try {
    const data = await run();
    console.log('[AI_READ_TOOL]', {
      cache: options.cache,
      latencyMs: Date.now() - startedAt,
      source,
      status: 'ok',
      toolName,
    });
    return {
      blockNumber,
      cache: options.cache,
      confidence: options.confidence || 'high',
      data: jsonSafe(data) as T,
      fetchedAt,
      freshness: {
        blockNumber,
        cache: options.cache,
        fetchedAt,
      },
      limitations: options.limitations || [],
      source,
      status: 'ok',
      truncated: options.truncated,
    };
  } catch (error) {
    console.warn('[AI_READ_TOOL]', {
      error: errorMessage(error),
      latencyMs: Date.now() - startedAt,
      source,
      status: 'error',
      toolName,
    });
    return {
      blockNumber,
      cache: options.cache,
      confidence: 'low',
      error: errorMessage(error),
      fetchedAt,
      freshness: {
        blockNumber,
        cache: options.cache,
        fetchedAt,
      },
      limitations: options.limitations || ['The read-only data source returned an error.'],
      source,
      status: 'error',
    };
  }
}

function normalizePlant(plant: Plant) {
  const fence = getFenceStatus(plant);
  const activeItems = (plant.extensions || [])
    .flatMap((extension) => extension.shopItemOwned || [])
    .filter((item) => Boolean(item.effectIsOngoingActive))
    .map((item) => ({
      effectUntil: Number(item.effectUntil || 0),
      effectUntilIso: Number(item.effectUntil || 0) > 0 ? new Date(Number(item.effectUntil) * 1000).toISOString() : null,
      id: String(item.id),
      name: item.name,
    }));

  return {
    activeItems,
    bornAt: plant.timePlantBorn,
    fence: {
      active: fence.hasActiveFence,
      daysRemaining: fence.daysRemaining,
      expiresAt: fence.expiresAt,
      expiresAtIso: fence.expiresAt > 0 ? new Date(fence.expiresAt * 1000).toISOString() : null,
      type: fence.type,
    },
    id: plant.id,
    lastAttacked: plant.lastAttacked,
    lastAttackUsed: plant.lastAttackUsed,
    level: plant.level,
    name: plant.name || `Plant #${plant.id}`,
    owner: plant.owner,
    protected: fence.hasActiveFence,
    rewardsEth: plant.rewards / 1e18,
    scorePts: plant.score / 1e12,
    stars: plant.stars,
    status: plant.status,
    statusLabel: statusLabel(plant.status, plant.statusStr),
    strainId: plant.strain,
    strainName: PLANT_STRAINS_BY_ID[plant.strain]?.name || `Strain ${plant.strain}`,
    timeUntilStarvingHours: plant.timeUntilStarving / 3600,
    timeUntilStarvingSeconds: plant.timeUntilStarving,
  };
}

function summarizePlants(plants: ReturnType<typeof normalizePlant>[]) {
  const urgentPlants = plants.filter((plant) =>
    plant.status >= 2 || plant.timeUntilStarvingHours < 10
  );
  const protectedPlants = plants
    .filter((plant) => plant.fence.active)
    .sort((a, b) => (a.fence.expiresAt || 0) - (b.fence.expiresAt || 0));
  const topRewards = [...plants]
    .sort((a, b) => b.rewardsEth - a.rewardsEth)
    .slice(0, 10)
    .map((plant) => ({
      fence: plant.fence,
      id: plant.id,
      level: plant.level,
      name: plant.name,
      rewardsEth: plant.rewardsEth,
      scorePts: plant.scorePts,
      statusLabel: plant.statusLabel,
      strainName: plant.strainName,
    }));

  return {
    healthyPlants: plants.filter((plant) => plant.status <= 1).length,
    protectedCount: protectedPlants.length,
    protectedPlants: protectedPlants.slice(0, 10).map((plant) => ({
      fence: plant.fence,
      id: plant.id,
      level: plant.level,
      name: plant.name,
      statusLabel: plant.statusLabel,
      strainName: plant.strainName,
    })),
    topRewards,
    totalPlants: plants.length,
    totalPts: plants.reduce((sum, plant) => sum + plant.scorePts, 0),
    totalRewardsEth: plants.reduce((sum, plant) => sum + plant.rewardsEth, 0),
    totalStars: plants.reduce((sum, plant) => sum + plant.stars, 0),
    urgentCareCount: urgentPlants.length,
  };
}

function cooldownDetails(lastTimestamp: string | number | undefined, cooldownSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const last = Number(lastTimestamp || 0);
  const availableAt = last > 0 ? last + cooldownSeconds : 0;
  const remainingSeconds = Math.max(0, availableAt - now);

  return {
    available: remainingSeconds === 0,
    availableAt: availableAt > 0 ? availableAt : null,
    availableAtIso: availableAt > 0 ? new Date(availableAt * 1000).toISOString() : null,
    cooldownSeconds,
    remainingSeconds,
  };
}

async function readKillCooldownForWallet(address: `0x${string}`, readClient: PixotchiReadClient) {
  const [canKillResult, remainingResult, cooldownSecondsResult] = await readClient.multicall({
    allowFailure: true,
    contracts: [
      {
        address: PIXOTCHI_NFT_ADDRESS,
        abi: KILL_COOLDOWN_ABI,
        functionName: 'canKill',
        args: [address],
      },
      {
        address: PIXOTCHI_NFT_ADDRESS,
        abi: KILL_COOLDOWN_ABI,
        functionName: 'getKillCooldownRemaining',
        args: [address],
      },
      {
        address: PIXOTCHI_NFT_ADDRESS,
        abi: KILL_COOLDOWN_ABI,
        functionName: 'getKillCooldownSeconds',
      },
    ],
  });
  const canKill = canKillResult?.status === 'success' ? Boolean(canKillResult.result) : null;
  const remainingSeconds = remainingResult?.status === 'success' ? Number(remainingResult.result) : null;
  const cooldownSeconds = cooldownSecondsResult?.status === 'success' ? Number(cooldownSecondsResult.result) : 60 * 60;
  const availableAt = remainingSeconds && remainingSeconds > 0
    ? Math.floor(Date.now() / 1000) + remainingSeconds
    : null;

  return {
    availableAt,
    availableAtIso: availableAt ? new Date(availableAt * 1000).toISOString() : null,
    canKill,
    cooldownSeconds,
    remainingSeconds,
  };
}

function summarizeAttackPlant(plant: ReturnType<typeof normalizePlant>) {
  return {
    fence: plant.fence,
    id: plant.id,
    level: plant.level,
    name: plant.name,
    owner: plant.owner,
    scorePts: plant.scorePts,
    status: plant.status,
    statusLabel: plant.statusLabel,
    strainName: plant.strainName,
  };
}

function normalizeBuilding(building: BuildingData | UntypedValue, kind: 'town' | 'village') {
  const id = Number(building?.id ?? building?.[0] ?? 0);
  const level = Number(building?.level ?? building?.[1] ?? 0);
  const name = kind === 'village'
    ? VILLAGE_BUILDING_NAMES[id as keyof typeof VILLAGE_BUILDING_NAMES] || `Village Building ${id}`
    : TOWN_BUILDING_LABELS[id] || `Town Building ${id}`;

  return {
    accumulatedLifetimeSeconds: toNumber(building?.accumulatedLifetime ?? building?.[6]),
    accumulatedPoints: toNumber(building?.accumulatedPoints ?? building?.[5], 12),
    id,
    kind,
    level,
    maxLevel: Number(building?.maxLevel ?? building?.[2] ?? 0),
    name,
    productionLifetimePerDaySeconds: toNumber(building?.productionRatePlantLifetimePerDay ?? building?.[4]),
    productionPtsPerDay: toNumber(building?.productionRatePlantPointsPerDay ?? building?.[3], 12),
    upgrading: Boolean(building?.isUpgrading ?? building?.[9] ?? false),
  };
}

function summarizeBuildings(results: Array<{ townBuildings?: UntypedValue[]; villageBuildings?: UntypedValue[] }>) {
  const builtBuildings: Record<string, {
    count: number;
    id: number;
    kind: 'town' | 'village';
    maxLevel: number;
    name: string;
    upgradingCount: number;
  }> = {};

  const addBuiltBuilding = (building: UntypedValue, kind: 'town' | 'village') => {
    const id = Number(building?.id ?? building?.[0] ?? 0);
    const level = Number(building?.level ?? building?.[1] ?? 0);
    if (level <= 0) return;

    const key = `${kind}:${id}`;
    const name = kind === 'village'
      ? VILLAGE_BUILDING_NAMES[id as keyof typeof VILLAGE_BUILDING_NAMES] || `Village Building ${id}`
      : TOWN_BUILDING_LABELS[id] || `Town Building ${id}`;

    builtBuildings[key] ||= {
      count: 0,
      id,
      kind,
      maxLevel: Number(building?.maxLevel ?? building?.[2] ?? 0),
      name,
      upgradingCount: 0,
    };
    builtBuildings[key].count += 1;
    builtBuildings[key].maxLevel = Math.max(
      builtBuildings[key].maxLevel,
      Number(building?.maxLevel ?? building?.[2] ?? 0),
    );
    if (Boolean(building?.isUpgrading ?? building?.[9] ?? false)) {
      builtBuildings[key].upgradingCount += 1;
    }
  };

  const totals = results.reduce(
    (totals, entry) => {
      for (const building of entry.villageBuildings || []) {
        addBuiltBuilding(building, 'village');
        const level = Number(building?.level ?? building?.[1] ?? 0);
        if (level <= 0) continue;

        totals.accumulatedLifetimeSeconds += toNumber(building?.accumulatedLifetime ?? building?.[6]);
        totals.accumulatedPts += toNumber(building?.accumulatedPoints ?? building?.[5], 12);
        totals.productionLifetimePerDaySeconds += toNumber(building?.productionRatePlantLifetimePerDay ?? building?.[4]);
        totals.productionPtsPerDay += toNumber(building?.productionRatePlantPointsPerDay ?? building?.[3], 12);
      }

      for (const building of entry.townBuildings || []) {
        addBuiltBuilding(building, 'town');
        const level = Number(building?.level ?? building?.[1] ?? 0);
        if (level <= 0) continue;

        totals.accumulatedLifetimeSeconds += toNumber(building?.accumulatedLifetime ?? building?.[6]);
        totals.accumulatedPts += toNumber(building?.accumulatedPoints ?? building?.[5], 12);
        totals.productionLifetimePerDaySeconds += toNumber(building?.productionRatePlantLifetimePerDay ?? building?.[4]);
        totals.productionPtsPerDay += toNumber(building?.productionRatePlantPointsPerDay ?? building?.[3], 12);
      }

      return totals;
    },
    {
      accumulatedLifetimeHours: 0,
      accumulatedLifetimeSeconds: 0,
      accumulatedPts: 0,
      productionLifetimePerDayHours: 0,
      productionLifetimePerDaySeconds: 0,
      productionPtsPerDay: 0,
    },
  );

  return {
    ...totals,
    accumulatedLifetimeHours: totals.accumulatedLifetimeSeconds / 3600,
    builtBuildings: Object.values(builtBuildings).sort((a, b) => a.kind.localeCompare(b.kind) || a.id - b.id),
    productionLifetimePerDayHours: totals.productionLifetimePerDaySeconds / 3600,
  };
}

function normalizeBarracks(state: BarracksLandStateV2 | null) {
  if (!state?.isBuilt) {
    return { built: false };
  }

  const now = Math.floor(Date.now() / 1000);
  return {
    attackCooldownActive: Number(state.attackCooldownEndsAt) > now,
    attackCooldownEndsAt: state.attackCooldownEndsAt.toString(),
    built: true,
    defenseCooldownActive: Number(state.defenseCooldownEndsAt) > now,
    defenseCooldownEndsAt: state.defenseCooldownEndsAt.toString(),
    readyPhalanx: state.readyToClaimPhalanxTroops.toString(),
    readySwordsmen: state.readyToClaimSwordsmanTroops.toString(),
    stationedPhalanx: state.stationedPhalanxTroops.toString(),
    stationedSwordsmen: state.stationedSwordsmanTroops.toString(),
    totalPhalanx: state.totalPhalanxTroops.toString(),
    totalSwordsmen: state.totalSwordsmanTroops.toString(),
    trainingEndsAt: state.trainingEndsAt.toString(),
    trainingQueueAmount: state.trainingQueueAmount.toString(),
    trainingQueueTroopType: Number(state.trainingQueueTroopType) === 1 ? 'phalanx' : 'swordsman',
  };
}

function normalizeBarracksForRaid(state: BarracksLandStateV2 | null) {
  const normalized = normalizeBarracks(state);
  const now = Math.floor(Date.now() / 1000);
  const totalSwordsmen = state ? Number(state.totalSwordsmanTroops) : 0;
  const totalPhalanx = state ? Number(state.totalPhalanxTroops) : 0;

  return {
    ...normalized,
    attackReady: Boolean(state?.isBuilt) && Number(state?.attackCooldownEndsAt || 0) <= now && (totalSwordsmen + totalPhalanx) > 0,
    totalTroops: totalSwordsmen + totalPhalanx,
  };
}

function summarizeRaidPreview(preview: BarracksRaidPreviewV2 | null) {
  if (!preview) {
    return null;
  }

  return {
    attackerCooldownEndsAt: preview.attackerCooldownEndsAt.toString(),
    attackerPhalanxLost: preview.attackerPhalanxLost.toString(),
    attackerPower: preview.attackerPower.toString(),
    attackerSwordsmenLost: preview.attackerSwordsmenLost.toString(),
    attackerWon: preview.attackerWon,
    defenderCooldownEndsAt: preview.defenderCooldownEndsAt.toString(),
    defenderPhalanxLost: preview.defenderPhalanxLost.toString(),
    defenderPower: preview.defenderPower.toString(),
    defenderSwordsmenLost: preview.defenderSwordsmenLost.toString(),
    estimatedLifetimeLootSeconds: preview.estimatedLifetimeLoot.toString(),
    estimatedLifetimeLootHours: Number(preview.estimatedLifetimeLoot) / 3600,
    estimatedPointsLoot: formatPts(preview.estimatedPointsLoot),
    phalanxRequested: preview.phalanxRequested.toString(),
    statusCode: preview.statusCode,
    swordsmenRequested: preview.swordsmenRequested.toString(),
    survivingAttackerPhalanx: preview.survivingAttackerPhalanx.toString(),
    survivingAttackerSwordsmen: preview.survivingAttackerSwordsmen.toString(),
  };
}

function normalizeProductionBuilding(building: UntypedValue, kind: 'town' | 'village') {
  const normalized = normalizeBuilding(building, kind);
  return {
    ...normalized,
    unclaimedLifetimeHours: normalized.accumulatedLifetimeSeconds / 3600,
  };
}

function getLandBuildingProductionTotals(results: Array<{ landId: bigint; townBuildings?: UntypedValue[]; villageBuildings?: UntypedValue[] }>) {
  const perLand = results.map((entry) => {
    const buildings = [
      ...(entry.villageBuildings || []).map((building) => normalizeProductionBuilding(building, 'village')),
      ...(entry.townBuildings || []).map((building) => normalizeProductionBuilding(building, 'town')),
    ].filter((building) => building.level > 0);
    const totals = buildings.reduce(
      (totals, building) => {
        totals.unclaimedLifetimeSeconds += building.accumulatedLifetimeSeconds;
        totals.unclaimedPts += building.accumulatedPoints;
        totals.productionLifetimePerDaySeconds += building.productionLifetimePerDaySeconds;
        totals.productionPtsPerDay += building.productionPtsPerDay;
        return totals;
      },
      {
        productionLifetimePerDaySeconds: 0,
        productionPtsPerDay: 0,
        unclaimedLifetimeSeconds: 0,
        unclaimedPts: 0,
      },
    );

    return {
      buildingCount: buildings.length,
      buildings,
      landId: entry.landId.toString(),
      productionLifetimePerDayHours: totals.productionLifetimePerDaySeconds / 3600,
      productionLifetimePerDaySeconds: totals.productionLifetimePerDaySeconds,
      productionPtsPerDay: totals.productionPtsPerDay,
      unclaimedLifetimeHours: totals.unclaimedLifetimeSeconds / 3600,
      unclaimedLifetimeSeconds: totals.unclaimedLifetimeSeconds,
      unclaimedPts: totals.unclaimedPts,
    };
  });
  const totals = perLand.reduce(
    (totals, land) => {
      totals.productionLifetimePerDaySeconds += land.productionLifetimePerDaySeconds;
      totals.productionPtsPerDay += land.productionPtsPerDay;
      totals.unclaimedLifetimeSeconds += land.unclaimedLifetimeSeconds;
      totals.unclaimedPts += land.unclaimedPts;
      return totals;
    },
    {
      productionLifetimePerDaySeconds: 0,
      productionPtsPerDay: 0,
      unclaimedLifetimeSeconds: 0,
      unclaimedPts: 0,
    },
  );

  return {
    perLand,
    totals: {
      productionLifetimePerDayHours: totals.productionLifetimePerDaySeconds / 3600,
      productionLifetimePerDaySeconds: totals.productionLifetimePerDaySeconds,
      productionPtsPerDay: totals.productionPtsPerDay,
      unclaimedLifetimeHours: totals.unclaimedLifetimeSeconds / 3600,
      unclaimedLifetimeSeconds: totals.unclaimedLifetimeSeconds,
      unclaimedPts: totals.unclaimedPts,
    },
  };
}

function hasBuiltTownBuilding(entry: { townBuildings?: UntypedValue[] } | undefined, buildingId: number): boolean {
  return (entry?.townBuildings || []).some((building) =>
    Number(building?.id ?? building?.[0] ?? 0) === buildingId &&
    Number(building?.level ?? building?.[1] ?? 0) > 0
  );
}

function getBuiltTownBuildingLevel(entry: { townBuildings?: UntypedValue[] } | undefined, buildingId: number): number {
  const building = (entry?.townBuildings || []).find((candidate) => Number(candidate?.id ?? candidate?.[0] ?? 0) === buildingId);
  return Number(building?.level ?? building?.[1] ?? 0);
}

function formatSignedPts(raw: bigint | number | string | undefined): string {
  try {
    const value = BigInt(raw ?? 0);
    if (value < BigInt(0)) {
      return `-${formatPts(-value)}`;
    }
    return formatPts(value);
  } catch {
    return String(raw ?? '0');
  }
}

function formatDurationCompact(seconds: number): string {
  if (seconds <= 0) {
    return '0s';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

function normalizeQuestSlot(slot: UntypedValue, index: number, currentBlock: bigint) {
  const startBlock = BigInt(slot?.startBlock ?? slot?.[1] ?? 0);
  const endBlock = BigInt(slot?.endBlock ?? slot?.[2] ?? 0);
  const pseudoRndBlock = BigInt(slot?.pseudoRndBlock ?? slot?.[3] ?? 0);
  const coolDownBlock = BigInt(slot?.coolDownBlock ?? slot?.[4] ?? 0);
  const difficulty = Number(slot?.difficulty ?? slot?.[0] ?? 0);
  let status: 'available' | 'in_progress' | 'ready_to_commit' | 'committed' | 'cooldown' = 'available';
  let targetBlock: bigint | null = null;
  let action = 'Start a quest from the Farmer House UI.';

  if (coolDownBlock !== BigInt(0) && currentBlock < coolDownBlock) {
    status = 'cooldown';
    targetBlock = coolDownBlock;
    action = 'Wait for cooldown to finish.';
  } else if (startBlock === BigInt(0)) {
    status = 'available';
    action = 'Start a new quest from the Farmer House UI.';
  } else if (currentBlock >= startBlock && currentBlock <= endBlock) {
    status = 'in_progress';
    targetBlock = endBlock;
    action = 'Wait until the quest is ready to return.';
  } else if (currentBlock > endBlock && pseudoRndBlock === BigInt(0)) {
    status = 'ready_to_commit';
    action = 'Use Return now in the Farmer House UI.';
  } else if (pseudoRndBlock !== BigInt(0)) {
    status = 'committed';
    action = 'Use Open now in the Farmer House UI.';
  }

  const blocksLeft = targetBlock && targetBlock > currentBlock ? Number(targetBlock - currentBlock) : 0;
  const durationSecondsLeft = blocksLeft * QUEST_BLOCK_SECONDS;
  const totalBlocks = endBlock > startBlock ? Number(endBlock - startBlock) : 0;
  const progressBlocks = startBlock > BigInt(0) ? Math.max(0, Math.min(totalBlocks, Number(currentBlock - startBlock))) : 0;

  return {
    action,
    blocksLeft,
    cooldownBlock: coolDownBlock.toString(),
    difficulty,
    difficultyLabel: difficulty === 2 ? 'Hard' : difficulty === 1 ? 'Med' : 'Easy',
    endBlock: endBlock.toString(),
    etaSeconds: durationSecondsLeft,
    etaText: formatDurationCompact(durationSecondsLeft),
    index,
    progressPct: totalBlocks <= 0 ? 0 : (progressBlocks / totalBlocks) * 100,
    pseudoRndBlock: pseudoRndBlock.toString(),
    startBlock: startBlock.toString(),
    status,
  };
}

function summarizeBarracksReport(report: BarracksRaidReportV2 | UntypedValue | null | undefined, perspective: 'incoming' | 'outgoing') {
  const raidId = BigInt(report?.raidId ?? report?.[0] ?? 0);
  if (!report || raidId === BigInt(0)) {
    return null;
  }

  const timestamp = BigInt(report.timestamp ?? report[1] ?? 0);
  const attackerWon = Boolean(report.attackerWon ?? report[4] ?? false);
  const outcomeForUser = perspective === 'outgoing'
    ? (attackerWon ? 'raid_won' : 'raid_lost')
    : (attackerWon ? 'defense_lost' : 'defended_successfully');

  return {
    attackerLandId: String(report.attackerLandId ?? report[2] ?? '0'),
    attackerPower: String(report.attackerPower ?? report[19] ?? '0'),
    attackerWon,
    defenderLandId: String(report.defenderLandId ?? report[3] ?? '0'),
    defenderPower: String(report.defenderPower ?? report[20] ?? '0'),
    lifetimeStolenHours: toNumber(report.lifetimeStolen ?? report[24]) / 3600,
    lifetimeStolenSeconds: String(report.lifetimeStolen ?? report[24] ?? '0'),
    outcomeForUser,
    pendingLifetimeSettledHours: toNumber(report.pendingLifetimeSettled ?? report[22]) / 3600,
    pendingLifetimeSettledSeconds: String(report.pendingLifetimeSettled ?? report[22] ?? '0'),
    pendingPointsSettled: formatPts(report.pendingPointsSettled ?? report[21]),
    perspective,
    phalanx: {
      sent: String(report.phalanxSent ?? report[6] ?? '0'),
      attackerBefore: String(report.attackerPhalanxBefore ?? report[8] ?? '0'),
      attackerLost: String(report.attackerPhalanxLost ?? report[12] ?? '0'),
      defenderBefore: String(report.defenderPhalanxBefore ?? report[10] ?? '0'),
      defenderLost: String(report.defenderPhalanxLost ?? report[14] ?? '0'),
      survivingAttackers: String(report.survivingAttackerPhalanx ?? report[16] ?? '0'),
      survivingDefenders: String(report.survivingDefenderPhalanx ?? report[18] ?? '0'),
    },
    pointsStolen: formatPts(report.pointsStolen ?? report[23]),
    raidId: raidId.toString(),
    swordsmen: {
      sent: String(report.swordsmenSent ?? report[5] ?? '0'),
      attackerBefore: String(report.attackerSwordsmenBefore ?? report[7] ?? '0'),
      attackerLost: String(report.attackerSwordsmenLost ?? report[11] ?? '0'),
      defenderBefore: String(report.defenderSwordsmenBefore ?? report[9] ?? '0'),
      defenderLost: String(report.defenderSwordsmenLost ?? report[13] ?? '0'),
      survivingAttackers: String(report.survivingAttackerSwordsmen ?? report[15] ?? '0'),
      survivingDefenders: String(report.survivingDefenderSwordsmen ?? report[17] ?? '0'),
    },
    timestamp: timestamp.toString(),
    timestampIso: timestamp > BigInt(0) ? new Date(Number(timestamp) * 1000).toISOString() : null,
  };
}

async function readArcadeStatusForPlant(readClient: PixotchiReadClient, plant: ReturnType<typeof normalizePlant>, sharedSpin: {
  globalCooldownSeconds: number;
  starCost: number;
}) {
  const plantId = BigInt(plant.id);
  const [boxNormal, boxStar, spinPerNft] = await Promise.allSettled([
    readClient.readContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: BOX_GAME_ABI,
      functionName: 'boxGameGetCoolDownTimePerNFT',
      args: [plantId],
    }) as Promise<bigint>,
    readClient.readContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: BOX_GAME_ABI,
      functionName: 'boxGameGetCoolDownTimeWithStar',
      args: [plantId],
    }) as Promise<bigint>,
    readClient.readContract({
      address: PIXOTCHI_NFT_ADDRESS,
      abi: SPIN_GAME_ABI,
      functionName: 'spinGameV2GetCoolDownTimePerNFT',
      args: [plantId],
    }) as Promise<bigint>,
  ]);
  const boxNormalSeconds = boxNormal.status === 'fulfilled' ? Number(boxNormal.value) : null;
  const boxStarSeconds = boxStar.status === 'fulfilled' ? Number(boxStar.value) : null;
  const spinSeconds = spinPerNft.status === 'fulfilled' ? Number(spinPerNft.value) : null;

  return {
    box: {
      normal: {
        ready: boxNormalSeconds === 0,
        remainingSeconds: boxNormalSeconds,
        remainingText: boxNormalSeconds == null ? null : formatDurationCompact(boxNormalSeconds),
      },
      withStar: {
        ready: boxStarSeconds === 0 && plant.stars > 0,
        remainingSeconds: boxStarSeconds,
        remainingText: boxStarSeconds == null ? null : formatDurationCompact(boxStarSeconds),
        requiresStar: true,
      },
    },
    id: plant.id,
    name: plant.name,
    spin: {
      globalCooldownSeconds: sharedSpin.globalCooldownSeconds,
      ready: spinSeconds === 0 && plant.stars >= sharedSpin.starCost,
      remainingSeconds: spinSeconds,
      remainingText: spinSeconds == null ? null : formatDurationCompact(spinSeconds),
      starCost: sharedSpin.starCost,
    },
    stars: plant.stars,
    statusLabel: plant.statusLabel,
    strainName: plant.strainName,
  };
}

function normalizeLand(land: Land, details?: {
  barracks?: BarracksLandStateV2 | null;
  quests?: UntypedValue[];
  townBuildings?: UntypedValue[];
  villageBuildings?: UntypedValue[];
}) {
  const villageBuildings = (details?.villageBuildings || [])
    .filter((building) => Number(building?.level ?? building?.[1] ?? 0) > 0)
    .map((building) => normalizeBuilding(building, 'village'));
  const townBuildings = (details?.townBuildings || [])
    .filter((building) => Number(building?.level ?? building?.[1] ?? 0) > 0)
    .map((building) => normalizeBuilding(building, 'town'));

  for (const prebuilt of [
    { id: 1, level: 1, maxLevel: 1 },
    { id: 3, level: 1, maxLevel: 1 },
  ]) {
    if (!townBuildings.some((building) => building.id === prebuilt.id)) {
      townBuildings.unshift(normalizeBuilding(prebuilt, 'town'));
    }
  }

  return {
    barracks: normalizeBarracks(details?.barracks ?? null),
    buildings: {
      town: townBuildings,
      village: villageBuildings,
    },
    coordinates: {
      x: Number(land.coordinateX),
      y: Number(land.coordinateY),
    },
    experiencePoints: formatToken(land.experiencePoints),
    id: land.tokenId.toString(),
    name: land.name || `Land #${land.tokenId.toString()}`,
    owner: land.owner,
    quests: details?.quests || [],
    storedLifetimeSeconds: formatSeconds(land.accumulatedPlantLifetime),
    storedLifetimeHours: toNumber(land.accumulatedPlantLifetime) / 3600,
    storedPts: formatPts(land.accumulatedPlantPoints),
  };
}

async function readPlantsForAddress(address: `0x${string}`, readClient: PixotchiReadClient) {
  return getPlantsByOwner(address, readClient);
}

async function readLandsForInput(
  address: `0x${string}`,
  landIds: number[] | undefined,
  readClient: PixotchiReadClient,
) {
  if (landIds?.length) {
    const ids = landIds.map((id) => BigInt(id));
    return getLandsByIds(ids, { readClient });
  }
  return getLandsByOwner(address, readClient);
}

type MarketplaceOrder = {
  amount: bigint;
  amountAsk: bigint;
  id: bigint;
  isActive: boolean;
  sellToken: number;
  seller: `0x${string}`;
};

function normalizeMarketplaceOrder(order: UntypedValue): MarketplaceOrder {
  return {
    amount: BigInt(order?.amount ?? order?.[3] ?? 0),
    amountAsk: BigInt(order?.amountAsk ?? order?.[5] ?? 0),
    id: BigInt(order?.id ?? order?.[0] ?? 0),
    isActive: Boolean(order?.isActive ?? order?.[4] ?? false),
    sellToken: Number(order?.sellToken ?? order?.[2] ?? 0),
    seller: getAddress(String(order?.seller ?? order?.[1] ?? ZERO_ADDRESS)),
  };
}

function marketplacePriceLeafPerSeed(order: MarketplaceOrder): number {
  const amount = Number(formatUnits(order.amount, 18));
  const amountAsk = Number(formatUnits(order.amountAsk, 18));
  if (order.sellToken === 1) {
    return amountAsk === 0 ? 0 : amount / amountAsk;
  }
  return amount === 0 ? 0 : amountAsk / amount;
}

function compactMarketplaceOrder(order: MarketplaceOrder) {
  const offeredSymbol = order.sellToken === 1 ? 'LEAF' : 'SEED';
  const wantedSymbol = order.sellToken === 1 ? 'SEED' : 'LEAF';
  return {
    amountDisplay: `${compactTokenAmount(formatToken(order.amount))} ${offeredSymbol}`,
    amountWantedDisplay: `${compactTokenAmount(formatToken(order.amountAsk))} ${wantedSymbol}`,
    id: order.id.toString(),
    isActive: order.isActive,
    priceLeafPerSeed: marketplacePriceLeafPerSeed(order),
    seller: order.seller,
    side: order.sellToken === 1 ? 'ask' : 'bid',
    offeredToken: offeredSymbol,
    wantedToken: wantedSymbol,
  };
}

function summarizeOrderBook(orders: MarketplaceOrder[], limit: number) {
  const activeOrders = orders.filter((order) => order.isActive);
  const asks = activeOrders
    .filter((order) => order.sellToken === 1)
    .sort((a, b) => marketplacePriceLeafPerSeed(a) - marketplacePriceLeafPerSeed(b));
  const bids = activeOrders
    .filter((order) => order.sellToken === 0)
    .sort((a, b) => marketplacePriceLeafPerSeed(b) - marketplacePriceLeafPerSeed(a));
  const totalLeafOffered = asks.reduce((sum, order) => sum + order.amount, BigInt(0));
  const totalSeedOffered = bids.reduce((sum, order) => sum + order.amount, BigInt(0));

  return {
    activeOrderCount: activeOrders.length,
    asks: asks.slice(0, limit).map(compactMarketplaceOrder),
    bestAskLeafPerSeed: asks[0] ? marketplacePriceLeafPerSeed(asks[0]) : null,
    bestBidLeafPerSeed: bids[0] ? marketplacePriceLeafPerSeed(bids[0]) : null,
    bids: bids.slice(0, limit).map(compactMarketplaceOrder),
    spreadLeafPerSeed: asks[0] && bids[0] ? marketplacePriceLeafPerSeed(asks[0]) - marketplacePriceLeafPerSeed(bids[0]) : null,
    totalLeafOfferedDisplay: `${compactTokenAmount(formatToken(totalLeafOffered))} LEAF`,
    totalSeedOfferedDisplay: `${compactTokenAmount(formatToken(totalSeedOffered))} SEED`,
  };
}

function normalizeCasinoActiveBet(activeBet: UntypedValue) {
  if (!activeBet) {
    return null;
  }

  const token = String(activeBet.bettingToken || PIXOTCHI_TOKEN_ADDRESS);
  return {
    bettingToken: token,
    bettingTokenSymbol: getAIPriceTokenSymbol(token),
    canReveal: Boolean(activeBet.canReveal),
    isActive: Boolean(activeBet.isActive),
    isExpired: Boolean(activeBet.isExpired),
    numBets: String(activeBet.numBets ?? '0'),
    player: activeBet.player,
    revealBlock: String(activeBet.revealBlock ?? '0'),
    totalBetDisplay: `${formatKnownTokenAmount(activeBet.totalBetAmount, token)} ${getAIPriceTokenSymbol(token)}`,
  };
}

function normalizeCasinoStats(stats: UntypedValue, tokenAddress?: string) {
  if (!stats) {
    return null;
  }

  const symbol = getAIPriceTokenSymbol(tokenAddress);
  return {
    gamesPlayed: String(stats.gamesPlayed ?? '0'),
    totalWageredDisplay: `${formatKnownTokenAmount(stats.totalWagered, tokenAddress)} ${symbol}`,
    totalWonDisplay: `${formatKnownTokenAmount(stats.totalWon, tokenAddress)} ${symbol}`,
  };
}

function normalizeBlackjackSnapshot(snapshot: UntypedValue, tokenAddress?: string) {
  if (!snapshot) {
    return null;
  }

  return {
    actionHandIndex: Number(snapshot.actionHandIndex ?? 0),
    activeHandCount: Number(snapshot.activeHandCount ?? 0),
    availableActions: {
      canDouble: Boolean(snapshot.canDouble),
      canHit: Boolean(snapshot.canHit),
      canSplit: Boolean(snapshot.canSplit),
      canStand: Boolean(snapshot.canStand),
      canSurrender: Boolean(snapshot.canSurrender),
    },
    betDisplay: `${formatKnownTokenAmount(snapshot.betAmount, tokenAddress)} ${getAIPriceTokenSymbol(tokenAddress)}`,
    dealerValue: Number(snapshot.dealerValue ?? 0),
    hand1Value: Number(snapshot.hand1Value ?? 0),
    hand2Value: Number(snapshot.hand2Value ?? 0),
    hasSplit: Boolean(snapshot.hasSplit),
    isActive: Boolean(snapshot.isActive),
    phase: Number(snapshot.phase ?? 0),
    player: snapshot.player,
  };
}

function buildMissionTaskRows(mission: UntypedValue) {
  const rows = [
    { done: Boolean(mission?.s1?.makeSwap), id: 's1_make_swap', label: 'Make a SEED swap', section: 'General', where: 'Swap' },
    { done: Boolean(mission?.s1?.stakeSeed), id: 's1_stake_seed', label: 'Stake SEED', section: 'General', where: 'Staking' },
    { done: Boolean(mission?.s1?.claimStake), id: 's1_claim_stake', label: 'Claim stake rewards', section: 'General', where: 'Staking' },
    { done: Boolean(mission?.s1?.placeOrder), id: 's1_place_order', label: 'Place a SEED/LEAF order', section: 'General', where: 'Land Marketplace' },
    { done: Boolean(mission?.s2?.followPlayer), id: 's2_follow_player', label: 'Follow a player', section: 'Social', where: 'Profile/Social' },
    { done: Boolean(mission?.s2?.chatMessage), id: 's2_chat_message', label: 'Send a public chat message', section: 'Social', where: 'Public Chat' },
    { done: Boolean(mission?.s2?.visitProfile), id: 's2_visit_profile', label: 'Visit a profile', section: 'Social', where: 'Profile/Social' },
    { done: Boolean(mission?.s3?.applyResources), id: 's3_apply_resources', label: 'Apply resources to a plant', section: 'Land', where: 'Land/Warehouse' },
    { done: Boolean(mission?.s3?.sendQuest), id: 's3_send_quest', label: 'Send a farmer on a quest', section: 'Land', where: 'Land Quests' },
    { done: Boolean(mission?.s3?.claimProduction), id: 's3_claim_production', label: 'Claim production from a building', section: 'Land', where: 'Land Buildings' },
    { done: Boolean(mission?.s3?.playCasinoGame), id: 's3_play_casino_game', label: 'Play a casino game', section: 'Land', where: 'Casino/Blackjack' },
    { done: Boolean(mission?.s4?.buy10), id: 's4_buy10_elements', label: `Buy at least 10 elements (${Number(mission?.s4?.buyElementsCount || 0)}/10)`, section: 'Plant', where: 'Plant Shop' },
    { done: Boolean(mission?.s4?.buyShield), id: 's4_buy_shield', label: 'Buy a shield/fence', section: 'Plant', where: 'Plant Shop/Fence' },
    { done: Boolean(mission?.s4?.collectStar), id: 's4_collect_star', label: 'Collect a star by killing an already-dead plant', section: 'Plant', where: 'Ranking/Dead' },
    { done: Boolean(mission?.s4?.playArcade), id: 's4_play_arcade', label: 'Play an arcade game', section: 'Plant', where: 'Arcade' },
  ];

  return {
    completed: rows.filter((row) => row.done),
    incomplete: rows.filter((row) => !row.done),
    rows,
  };
}

async function readErc20Allowance(
  readClient: PixotchiReadClient,
  tokenAddress: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`,
): Promise<bigint> {
  return readClient.readContract({
    address: tokenAddress,
    abi: ERC20_ALLOWANCE_ABI,
    functionName: 'allowance',
    args: [owner, spender],
  }) as Promise<bigint>;
}

function sameAddress(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a && b && isAddress(a) && isAddress(b) && getAddress(a).toLowerCase() === getAddress(b).toLowerCase());
}

function extractTxHash(value: string | undefined): string | undefined {
  return value?.match(/0x[a-fA-F0-9]{64}/)?.[0];
}

function getTransferEvent(contract: KnownTransferContract) {
  return contract.standard === 'erc721' ? ERC721_TRANSFER_EVENT : ERC20_TRANSFER_EVENT;
}

function normalizeIndexedActivity(event: ActivityEvent): NormalizedOnchainActivity {
  const data = event as UntypedValue;
  const base = {
    blockNumber: data.blockHeight ? String(data.blockHeight) : undefined,
    confidence: 'high' as const,
    source: 'Ponder indexer',
    timestamp: data.timestamp ? String(data.timestamp) : undefined,
    txHash: extractTxHash(data.id),
  };

  switch (event.__typename) {
    case 'Mint':
      return { ...base, assetType: 'plant', kind: 'plant_mint', tokenId: String(data.nftId ?? '') };
    case 'LandMintedEvent':
      return { ...base, assetType: 'land', kind: 'land_mint', tokenId: String(data.tokenId ?? ''), token: 'SEED' };
    case 'LandTransferEvent':
      return { ...base, assetType: 'land', counterparty: data.from || data.to, kind: 'land_transfer', tokenId: String(data.tokenId ?? '') };
    case 'Attack':
      return { ...base, assetType: 'game', kind: 'plant_attack' };
    case 'Killed':
      return { ...base, assetType: 'plant', kind: 'plant_killed', tokenId: String(data.deadId ?? data.nftId ?? '') };
    case 'ItemConsumed':
    case 'ShopItemPurchased':
      return { ...base, assetType: 'plant', kind: event.__typename === 'ItemConsumed' ? 'item_consumed' : 'shop_item_purchased', tokenId: String(data.nftId ?? '') };
    case 'Played':
      return { ...base, assetType: 'plant', kind: 'arcade_played', tokenId: String(data.nftId ?? '') };
    case 'QuestStartedEvent':
      return { ...base, assetType: 'land', kind: 'quest_started', tokenId: String(data.landId ?? '') };
    case 'QuestFinalizedEvent':
      return { ...base, amountDisplay: data.amount ? String(data.amount) : undefined, assetType: 'land', kind: 'quest_finalized', tokenId: String(data.landId ?? '') };
    case 'VillageProductionClaimedEvent':
      return { ...base, assetType: 'land', kind: 'production_claimed', tokenId: String(data.landId ?? '') };
    case 'VillageUpgradedWithLeafEvent':
    case 'TownUpgradedWithLeafEvent':
      return { ...base, amountDisplay: data.upgradeCost ? String(data.upgradeCost) : undefined, assetType: 'land', kind: 'building_upgraded', token: 'LEAF', tokenId: String(data.landId ?? '') };
    case 'VillageSpeedUpWithSeedEvent':
    case 'TownSpeedUpWithSeedEvent':
      return { ...base, amountDisplay: data.speedUpCost ? String(data.speedUpCost) : undefined, assetType: 'land', kind: 'building_speedup', token: 'PIXOTCHI', tokenId: String(data.landId ?? '') };
    case 'BarracksBuiltEvent':
      return { ...base, assetType: 'land', kind: 'barracks_built', tokenId: String(data.landId ?? '') };
    case 'BarracksRaidEvent':
      return { ...base, assetType: 'land', kind: 'barracks_raid', tokenId: String(data.attackerLandId ?? '') };
    case 'CasinoBuiltEvent':
      return { ...base, assetType: 'land', kind: 'casino_built', tokenId: String(data.landId ?? '') };
    case 'RouletteSpinResultEvent':
      return { ...base, assetType: 'land', kind: 'roulette_result', tokenId: String(data.landId ?? '') };
    case 'BlackjackResultEvent':
      return { ...base, assetType: 'land', kind: 'blackjack_result', tokenId: String(data.landId ?? '') };
    default:
      return { ...base, assetType: 'game', kind: event.__typename };
  }
}

function getTransferArgs(log: UntypedValue, contract: KnownTransferContract): { from?: string; to?: string; value?: bigint } | null {
  const args = log?.args;
  if (args?.from || args?.to) {
    return {
      from: args.from,
      to: args.to,
      value: args.value ?? args.tokenId,
    };
  }

  try {
    const decoded = decodeEventLog({
      abi: [getTransferEvent(contract)],
      data: log.data as Hex,
      topics: log.topics as [Hex, ...Hex[]],
    });
    const decodedArgs = decoded.args as { from?: string; to?: string; tokenId?: bigint; value?: bigint };
    return {
      from: decodedArgs.from,
      to: decodedArgs.to,
      value: decodedArgs.value ?? decodedArgs.tokenId,
    };
  } catch {
    return null;
  }
}

function normalizeTransferActivity(
  log: UntypedValue,
  contract: KnownTransferContract,
  target: `0x${string}`,
  source: string,
): NormalizedOnchainActivity | null {
  const args = getTransferArgs(log, contract);
  if (!args?.from || !args?.to) return null;

  const from = getAddress(args.from);
  const to = getAddress(args.to);
  const value = BigInt(args.value ?? 0);
  const isIncoming = sameAddress(to, target);
  const isOutgoing = sameAddress(from, target);
  const isMint = sameAddress(from, ZERO_ADDRESS);
  const direction = isIncoming && isOutgoing
    ? 'self'
    : isIncoming
      ? 'in'
      : isOutgoing
        ? 'out'
        : 'unknown';
  const kind = contract.standard === 'erc721'
    ? isMint
      ? `${contract.assetType}_mint`
      : `${contract.assetType}_transfer`
    : 'token_transfer';

  return {
    amountDisplay: contract.standard === 'erc20'
      ? `${compactTokenAmount(formatToken(value, contract.decimals))} ${contract.symbol}`
      : undefined,
    assetType: contract.assetType,
    blockNumber: log.blockNumber?.toString(),
    confidence: 'medium',
    counterparty: direction === 'in' ? from : direction === 'out' ? to : undefined,
    direction,
    kind,
    source,
    token: contract.symbol,
    tokenId: contract.standard === 'erc721' ? value.toString() : undefined,
    txHash: log.transactionHash,
  };
}

function sortActivitiesDescending(activities: NormalizedOnchainActivity[]): NormalizedOnchainActivity[] {
  return [...activities].sort((a, b) => {
    const blockA = Number(a.blockNumber || 0);
    const blockB = Number(b.blockNumber || 0);
    if (blockA !== blockB) return blockB - blockA;
    return String(b.txHash || '').localeCompare(String(a.txHash || ''));
  });
}

function timestampMetadata(timestamp: string | number | undefined) {
  const seconds = Number(timestamp || 0);
  return {
    timestamp: seconds > 0 ? String(seconds) : undefined,
    timestampIso: seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined,
  };
}

function formatPtsNumber(raw: UntypedValue): number {
  try {
    if (typeof raw === 'bigint') return Number(formatUnits(raw, 12));
    if (typeof raw === 'number') return raw / 1e12;
    if (typeof raw === 'string' && raw.trim()) return Number(formatUnits(BigInt(raw), 12));
  } catch {
    return Number(raw || 0);
  }
  return 0;
}

function normalizePlantCombatEvent(event: UntypedValue, ownedPlantIds: Set<string>) {
  const attackerId = String(event.attacker ?? '');
  const winnerId = String(event.winner ?? '');
  const loserId = String(event.loser ?? '');
  const attackerIsMine = ownedPlantIds.has(attackerId);
  const winnerIsMine = ownedPlantIds.has(winnerId);
  const loserIsMine = ownedPlantIds.has(loserId);
  const targetId = winnerId === attackerId ? loserId : winnerId;
  const targetName = winnerId === attackerId ? event.loserName : event.winnerName;
  const direction = attackerIsMine ? 'outgoing' : (winnerIsMine || loserIsMine ? 'incoming' : 'related');
  const outcomeForUser = direction === 'outgoing'
    ? (winnerIsMine ? 'attack_won' : 'attack_lost')
    : direction === 'incoming'
      ? (winnerIsMine ? 'defended_successfully' : 'defense_lost')
      : 'unknown';

  return {
    ...timestampMetadata(event.timestamp),
    attacker: {
      id: attackerId,
      mine: attackerIsMine,
      name: event.attackerName || `Plant #${attackerId}`,
    },
    direction,
    id: String(event.id || ''),
    kind: 'plant_attack',
    outcomeForUser,
    scoresWonPts: formatPtsNumber(event.scoresWon),
    source: 'Ponder indexer plant Attack events',
    system: 'plants',
    target: {
      id: targetId,
      mine: ownedPlantIds.has(targetId),
      name: targetName || `Plant #${targetId}`,
    },
    winner: {
      id: winnerId,
      mine: winnerIsMine,
      name: event.winnerName || `Plant #${winnerId}`,
    },
    loser: {
      id: loserId,
      mine: loserIsMine,
      name: event.loserName || `Plant #${loserId}`,
    },
  };
}

function normalizeLandCombatEvent(event: UntypedValue, ownedLandIds: Set<string>) {
  const attackerLandId = String(event.attackerLandId ?? '');
  const defenderLandId = String(event.defenderLandId ?? '');
  const attackerIsMine = ownedLandIds.has(attackerLandId);
  const defenderIsMine = ownedLandIds.has(defenderLandId);
  const direction = attackerIsMine ? 'outgoing' : (defenderIsMine ? 'incoming' : 'related');
  const attackerWon = Boolean(event.attackerWon);
  const outcomeForUser = direction === 'outgoing'
    ? (attackerWon ? 'raid_won' : 'raid_lost')
    : direction === 'incoming'
      ? (attackerWon ? 'defense_lost' : 'defended_successfully')
      : 'unknown';

  return {
    ...timestampMetadata(event.timestamp),
    attackerLandId,
    attackerWon,
    blockNumber: event.blockHeight ? String(event.blockHeight) : undefined,
    defenderLandId,
    direction,
    id: String(event.id || ''),
    kind: 'land_raid',
    outcomeForUser,
    raidId: String(event.raidId || ''),
    source: 'Ponder indexer BarracksRaidEvent events',
    system: 'lands_barracks',
  };
}

function countBy<T extends Record<string, UntypedValue>>(
  items: T[],
  getKey: (item: T) => { id: string; label?: string } | undefined,
) {
  const counts = new Map<string, { count: number; label?: string }>();
  for (const item of items) {
    const key = getKey(item);
    if (!key?.id) continue;
    const current = counts.get(key.id);
    counts.set(key.id, {
      count: (current?.count || 0) + 1,
      label: current?.label || key.label,
    });
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([id, value]) => ({ count: value.count, id, label: value.label }));
}

function summarizeCombatActivity(events: UntypedValue[]) {
  const plantAttacks = events.filter((event) => event.kind === 'plant_attack');
  const landRaids = events.filter((event) => event.kind === 'land_raid');
  const incomingPlantAttacks = plantAttacks.filter((event) => event.direction === 'incoming');
  const outgoingPlantAttacks = plantAttacks.filter((event) => event.direction === 'outgoing');
  const incomingLandRaids = landRaids.filter((event) => event.direction === 'incoming');
  const outgoingLandRaids = landRaids.filter((event) => event.direction === 'outgoing');

  return {
    incomingLandRaids: incomingLandRaids.length,
    incomingPlantAttacks: incomingPlantAttacks.length,
    landDefenseLosses: incomingLandRaids.filter((event) => event.outcomeForUser === 'defense_lost').length,
    landDefenseWins: incomingLandRaids.filter((event) => event.outcomeForUser === 'defended_successfully').length,
    outgoingLandRaids: outgoingLandRaids.length,
    outgoingPlantAttacks: outgoingPlantAttacks.length,
    plantAttackLosses: outgoingPlantAttacks.filter((event) => event.outcomeForUser === 'attack_lost').length,
    plantAttackWins: outgoingPlantAttacks.filter((event) => event.outcomeForUser === 'attack_won').length,
    plantDefenseLosses: incomingPlantAttacks.filter((event) => event.outcomeForUser === 'defense_lost').length,
    plantDefenseWins: incomingPlantAttacks.filter((event) => event.outcomeForUser === 'defended_successfully').length,
    topIncomingLandAttackers: countBy(incomingLandRaids, (event) => {
      const id = String(event.attackerLandId || '');
      return id ? { id, label: `Land #${id}` } : undefined;
    }),
    topIncomingPlantAttackers: countBy(incomingPlantAttacks, (event) => {
      const attacker = event.attacker as UntypedValue;
      return attacker?.id ? { id: String(attacker.id), label: String(attacker.name || `Plant #${attacker.id}`) } : undefined;
    }),
    total: events.length,
  };
}

async function getTransferLogsForContract(
  readClient: PixotchiReadClient,
  contract: KnownTransferContract,
  args: { from?: `0x${string}`; to?: `0x${string}` },
  fromBlock: bigint,
  toBlock: bigint,
) {
  const logs: UntypedValue[] = [];
  const chunkSize = BigInt(50_000);
  const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  let cursor = fromBlock;

  while (cursor <= toBlock) {
    const chunkEnd = cursor + chunkSize - BigInt(1);
    const end = chunkEnd > toBlock ? toBlock : chunkEnd;
    ranges.push({ fromBlock: cursor, toBlock: end });
    cursor = end + BigInt(1);
  }

  for (let index = 0; index < ranges.length; index += AI_WALLET_ACTIVITY_LOG_CHUNK_CONCURRENCY) {
    const batch = ranges.slice(index, index + AI_WALLET_ACTIVITY_LOG_CHUNK_CONCURRENCY);
    const chunks = await Promise.all(batch.map((range) => readClient.getLogs({
      address: contract.address,
      args,
      event: getTransferEvent(contract),
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
    } as Parameters<typeof readClient.getLogs>[0])));

    for (const chunk of chunks) {
      logs.push(...(chunk as UntypedValue[]));
    }
  }

  return logs;
}

async function getKnownWalletTransferActivity(
  readClient: PixotchiReadClient,
  target: `0x${string}`,
  limit: number,
): Promise<{
  activities: NormalizedOnchainActivity[];
  fromBlock: string;
  toBlock: string;
  truncated: boolean;
}> {
  const currentBlock = await readClient.getBlockNumber();
  const range = BigInt(Math.max(1, AI_WALLET_ACTIVITY_BLOCK_RANGE));
  const fromBlock = currentBlock > range ? currentBlock - range : BigInt(0);
  const collected: NormalizedOnchainActivity[] = [];
  const contractResults = await Promise.allSettled(KNOWN_TRANSFER_CONTRACTS.map(async (contract) => {
    const [incoming, outgoing] = await Promise.allSettled([
      getTransferLogsForContract(readClient, contract, { to: target }, fromBlock, currentBlock),
      getTransferLogsForContract(readClient, contract, { from: target }, fromBlock, currentBlock),
    ]);
    const logs = [
      ...(incoming.status === 'fulfilled' ? incoming.value : []),
      ...(outgoing.status === 'fulfilled' ? outgoing.value : []),
    ];
    const seen = new Set<string>();
    const activities: NormalizedOnchainActivity[] = [];

    for (const log of logs) {
      const key = `${log.transactionHash}:${log.logIndex?.toString?.() ?? ''}:${contract.address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const normalized = normalizeTransferActivity(log, contract, target, 'Base RPC known-contract Transfer logs');
      if (normalized) activities.push(normalized);
    }
    return activities;
  }));

  for (const result of contractResults) {
    if (result.status === 'fulfilled') {
      collected.push(...result.value);
    }
  }

  const sorted = sortActivitiesDescending(collected);
  return {
    activities: sorted.slice(0, limit),
    fromBlock: fromBlock.toString(),
    toBlock: currentBlock.toString(),
    truncated: sorted.length > limit,
  };
}

function summarizeKnownReceiptLogs(logs: readonly UntypedValue[]): NormalizedOnchainActivity[] {
  const output: NormalizedOnchainActivity[] = [];
  const knownByAddress = new Map(KNOWN_TRANSFER_CONTRACTS.map((contract) => [contract.address.toLowerCase(), contract]));

  for (const log of logs) {
    const address = typeof log.address === 'string' ? log.address.toLowerCase() : '';
    const contract = knownByAddress.get(address);
    if (!contract) continue;
    const normalized = normalizeTransferActivity(log, contract, ZERO_ADDRESS as `0x${string}`, 'Base receipt known Pixotchi log');
    if (normalized) {
      output.push({
        ...normalized,
        counterparty: undefined,
        direction: undefined,
      });
    }
  }

  return output;
}

export function createReadOnlyAITools(context: ReadOnlyToolContext) {
  const readClient = getAIReadClient();
  const aiRpcSource = getAIRpcSourceLabel();

  return {
    get_game_action_guide: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Retrieve relevant safe Pixotchi knowledge topics: where actions live in the UI, what live data AI can read, and what transactions the user must do themselves. Use for how-to, onboarding, and action questions.',
      inputSchema: z.object({
        includeSafetyNotes: z.boolean().default(true),
        limit: z.number().int().min(1).max(24).default(12),
        query: z.string().trim().max(160).optional(),
        topic: GAME_ACTION_TOPIC_ENUM.optional(),
        topics: z.array(GAME_ACTION_TOPIC_ENUM).max(8).optional(),
      }),
      execute: async ({ includeSafetyNotes, limit, query, topic, topics }) => withToolResult(
        'get_game_action_guide',
        'Structured bundled Pixotchi knowledge guide',
        { cache: 'Bundled app knowledge topics', includeBlock: false },
        async () => ({
          actions: getGameActionGuide({
            includeSafetyNotes,
            limit,
            query,
            topic,
            topics,
          }),
          readOnlyPhase: true,
        }),
        readClient,
      ),
    }),

    get_token_info: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read app-approved SEED, LEAF, and PIXOTCHI token utility, tokenomics, contract addresses, and caveats from the same knowledge source used by Swap -> Info. Use for token info, tokenomics, utility, contract address, LEAF marketplace, PIXOTCHI creator coin, SEED burn/tax/reward questions. Never use this for financial advice.',
      inputSchema: z.object({
        token: PIXOTCHI_TOKEN_INFO_ENUM.default('all'),
      }),
      execute: async ({ token }) => withToolResult(
        'get_token_info',
        'Bundled Pixotchi token knowledge used by Swap -> Info',
        {
          cache: 'Bundled app token knowledge; contract addresses are public configuration.',
          includeBlock: false,
          limitations: [
            'Informational gameplay/token utility only.',
            'No financial advice, investment advice, price predictions, or buy/sell/hold recommendations.',
            'Live market stats require get_seed_market_pulse.',
          ],
        },
        async () => ({
          noFinancialAdvice: true,
          tokens: token === 'all'
            ? getAllPixotchiTokenInfo()
            : [getPixotchiTokenInfo(token)],
        }),
        readClient,
      ),
    }),

    get_seed_market_pulse: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read live-ish SEED market pulse data from the same DexScreener-backed source used by the Swap chart card: price, 24h volume, liquidity, market cap/FDV, price changes, txns, and 2% rewards estimate. Use for factual SEED market stats only, never financial advice.',
      inputSchema: z.object({}),
      execute: async () => withToolResult(
        'get_seed_market_pulse',
        `DexScreener SEED/Base pair data (${SEED_PAIR_DEXSCREENER_URL})`,
        {
          cache: 'DexScreener data is cached for about 5 minutes and may be stale if the upstream API is unavailable.',
          confidence: 'medium',
          includeBlock: false,
          limitations: [
            'DexScreener data may be delayed, cached, missing, or temporarily unavailable.',
            'Rewards estimate is 2% of reported 24h SEED trading volume.',
            'No financial advice, investment advice, price predictions, or buy/sell/hold recommendations.',
          ],
        },
        async () => ({
          market: await fetchSeedMarketPulse(),
          noFinancialAdvice: true,
          pairUrl: SEED_PAIR_DEXSCREENER_URL,
          poweredBy: ['DEX Screener', 'TradingView chart UI'],
        }),
        readClient,
      ),
    }),

    get_wallet_token_balances: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read public known-token balances for a wallet on Base. Only checks ETH, SEED, LEAF, PIXOTCHI, JESSE, and USDC; never arbitrary tokens.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        includeZeroBalances: z.boolean().default(true),
      }),
      execute: async ({ address, includeZeroBalances }) => withToolResult(
        'get_wallet_token_balances',
        `Base balance and ERC-20 balanceOf reads for known Pixotchi tokens via ${aiRpcSource}`,
        {
          includeBlock: true,
          limitations: ['Known tokens only: ETH, SEED, LEAF, PIXOTCHI, JESSE, and USDC.', 'This tool never queries arbitrary user-supplied token contracts.'],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const balances = await Promise.all(KNOWN_BALANCE_TOKENS.map(async (token) => {
            const raw = token.assetType === 'native'
              ? await readClient.getBalance({ address: target })
              : await getTokenBalanceForToken(target, token.address!, readClient);
            const amount = compactTokenAmount(formatToken(raw, token.decimals));
            return {
              address: token.address,
              amountDisplay: `${amount} ${token.symbol}`,
              amountRaw: raw.toString(),
              assetType: token.assetType,
              decimals: token.decimals,
              id: token.id,
              name: token.name,
              symbol: token.symbol,
            };
          }));

          return {
            address: target,
            knownTokensOnly: true,
            tokens: includeZeroBalances
              ? balances
              : balances.filter((balance) => BigInt(balance.amountRaw) > BigInt(0)),
          };
        },
        readClient,
      ),
    }),

    get_wallet_game_assets: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read public Pixotchi game assets for a wallet: plant NFTs, land NFTs, counts, current ownership, and urgent plant care state.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        landLimit: z.number().int().min(1).max(50).default(25),
        plantLimit: z.number().int().min(1).max(50).default(25),
      }),
      execute: async ({ address, landLimit, plantLimit }) => withToolResult(
        'get_wallet_game_assets',
        `Base contract reads for Pixotchi plant and land ownership via ${aiRpcSource}`,
        {
          includeBlock: true,
          limitations: ['Current onchain ownership wins over older activity history.', 'Large wallets are truncated to the requested limits.'],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const [plants, lands] = await Promise.all([
            readPlantsForAddress(target, readClient),
            getLandsByOwner(target, readClient),
          ]);
          const normalizedPlants = plants.map(normalizePlant);
          const urgentPlants = normalizedPlants.filter((plant) =>
            plant.status >= 2 || plant.timeUntilStarvingHours < 10
          );

          return {
            address: target,
            landSummary: {
              totalLands: lands.length,
              totalStoredLifetimeSeconds: lands.reduce((sum, land) => sum + toNumber(land.accumulatedPlantLifetime), 0),
              totalStoredLifetimeHours: lands.reduce((sum, land) => sum + toNumber(land.accumulatedPlantLifetime), 0) / 3600,
              totalStoredPts: lands.reduce((sum, land) => sum + toNumber(land.accumulatedPlantPoints, 12), 0),
            },
            lands: lands.slice(0, landLimit).map((land) => ({
              coordinates: {
                x: Number(land.coordinateX),
                y: Number(land.coordinateY),
              },
              id: land.tokenId.toString(),
              name: land.name || `Land #${land.tokenId.toString()}`,
              owner: land.owner,
              storedLifetimeSeconds: formatSeconds(land.accumulatedPlantLifetime),
              storedLifetimeHours: toNumber(land.accumulatedPlantLifetime) / 3600,
              storedPts: formatPts(land.accumulatedPlantPoints),
            })),
            plantSummary: {
              ...summarizePlants(normalizedPlants),
            },
            plants: normalizedPlants.slice(0, plantLimit),
            truncated: {
              lands: lands.length > landLimit,
              plants: normalizedPlants.length > plantLimit,
            },
            urgentPlants: urgentPlants.slice(0, 10),
          };
        },
        readClient,
      ),
    }),

    get_wallet_game_activity: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read recent public Pixotchi wallet activity from the indexer first, with a bounded Base RPC known-contract Transfer fallback for mints and transfers. Use rpcFallbackMode "always" for explicit mint/transfer history questions.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        includeIndexed: z.boolean().default(true),
        includeOnchainFallback: z.boolean().default(true),
        limit: z.number().int().min(1).max(50).default(12),
        rpcFallbackMode: z.enum(['auto', 'always', 'off']).default('auto'),
      }),
      execute: async ({ address, includeIndexed, includeOnchainFallback, limit, rpcFallbackMode }) => withToolResult(
        'get_wallet_game_activity',
        `Ponder indexer plus bounded Base RPC known-contract logs via ${aiRpcSource}`,
        {
          cache: 'Indexer user activity is cached briefly; RPC fallback is live and block-range bounded.',
          confidence: 'medium',
          includeBlock: true,
          limitations: ['Indexer user activity focuses on recent game events.', `RPC fallback checks known Pixotchi contracts only and is capped to the most recent ${AI_WALLET_ACTIVITY_BLOCK_RANGE} blocks.`, 'Older history may require the Activity tab, indexer, or a block explorer.'],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const errors: string[] = [];
          let indexedEvents: NormalizedOnchainActivity[] = [];

          if (includeIndexed) {
            try {
              indexedEvents = (await getCachedMyActivity(target)).map(normalizeIndexedActivity);
            } catch (error) {
              errors.push(`indexer: ${errorMessage(error)}`);
            }
          }

          const shouldFetchRpcFallback = includeOnchainFallback
            && rpcFallbackMode !== 'off'
            && (rpcFallbackMode === 'always' || !includeIndexed || indexedEvents.length < limit);
          let rpcActivity: Awaited<ReturnType<typeof getKnownWalletTransferActivity>> | null = null;

          if (shouldFetchRpcFallback) {
            try {
              rpcActivity = await getKnownWalletTransferActivity(readClient, target, Math.min(limit, AI_WALLET_ACTIVITY_LOG_LIMIT));
            } catch (error) {
              errors.push(`rpcFallback: ${errorMessage(error)}`);
            }
          }

          const combined = sortActivitiesDescending([
            ...indexedEvents,
            ...(rpcActivity?.activities || []),
          ]);

          return {
            address: target,
            combined: combined.slice(0, limit),
            errors,
            indexedRecentEvents: indexedEvents.slice(0, limit),
            onchainTransfers: rpcActivity?.activities || [],
            rpcFallback: {
              fetched: shouldFetchRpcFallback,
              mode: rpcFallbackMode,
              reason: shouldFetchRpcFallback
                ? 'Fetched bounded known-contract Base logs.'
                : 'Skipped because indexed activity satisfied the request.',
            },
            rpcBlockRange: rpcActivity
              ? {
                fromBlock: rpcActivity.fromBlock,
                toBlock: rpcActivity.toBlock,
              }
              : null,
            truncated: {
              combined: combined.length > limit,
              indexed: indexedEvents.length > limit,
              onchain: Boolean(rpcActivity?.truncated),
            },
          };
        },
        readClient,
      ),
    }),

    get_combat_activity: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read time-ranged Pixotchi combat history for a wallet, split between plant attacks and land Barracks raids. Use for "who attacked me", "who raided my land", "attacks in the last 4 hours/month", incoming/outgoing combat analysis, and distinguishing plant vs land combat systems. For month or broad history prompts, use limit 100.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        direction: z.enum(['all', 'incoming', 'outgoing']).default('all'),
        includeLandRaids: z.boolean().default(true),
        includePlantAttacks: z.boolean().default(true),
        limit: z.number().int().min(1).max(100).default(100),
        timeframeHours: z.number().int().min(1).max(AI_COMBAT_ACTIVITY_MAX_HOURS).default(24),
      }),
      execute: async ({ address, direction, includeLandRaids, includePlantAttacks, limit, timeframeHours }) => withToolResult(
        'get_combat_activity',
        'Ponder indexer time-ranged plant Attack and land BarracksRaidEvent history',
        {
          cache: 'Indexer-backed public combat events; current wallet ownership maps events to the player.',
          confidence: 'medium',
          includeBlock: true,
          limitations: [
            'Plant attacks and land raids are separate combat systems with different mechanics.',
            'Time-ranged history is based on indexed events and current owned plant/land IDs.',
            'Assets transferred away before the query may not be attributable to the current wallet.',
            `Maximum timeframe is ${AI_COMBAT_ACTIVITY_MAX_HOURS} hours unless configured higher.`,
          ],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const now = Math.floor(Date.now() / 1000);
          const cappedHours = Math.min(Math.max(1, timeframeHours), AI_COMBAT_ACTIVITY_MAX_HOURS);
          const fromTimestamp = now - cappedHours * 60 * 60;
          const [plants, lands] = await Promise.all([
            includePlantAttacks ? readPlantsForAddress(target, readClient) : Promise.resolve([]),
            includeLandRaids ? getLandsByOwner(target, readClient) : Promise.resolve([]),
          ]);
          const ownedPlantIds = new Set(plants.map((plant) => String(plant.id)));
          const ownedLandIds = new Set(lands.map((land) => land.tokenId.toString()));

          const data = await fetchIndexerGraphQL<UntypedValue>(buildCombatActivityQuery(direction), {
            fromTimestamp: String(fromTimestamp),
            landIds: includeLandRaids ? [...ownedLandIds] : [],
            limit,
            plantIds: includePlantAttacks ? [...ownedPlantIds] : [],
            toTimestamp: String(now),
          }, { revalidate: 3 });
          const plantEvents = includePlantAttacks
            ? (data.attacks?.items || []).map((event: UntypedValue) => normalizePlantCombatEvent(event, ownedPlantIds))
            : [];
          const landEvents = includeLandRaids
            ? (data.barracksRaidEvents?.items || []).map((event: UntypedValue) => normalizeLandCombatEvent(event, ownedLandIds))
            : [];
          const combined = [...plantEvents, ...landEvents]
            .filter((event) => direction === 'all' || event.direction === direction)
            .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
          const truncated = combined.length > limit || plantEvents.length >= limit || landEvents.length >= limit;
          const summary = summarizeCombatActivity(combined);

          return {
            address: target,
            combined: combined.slice(0, limit),
            direction,
            fromTimestamp: String(fromTimestamp),
            fromTimestampIso: new Date(fromTimestamp * 1000).toISOString(),
            includedSystems: {
              landRaids: includeLandRaids,
              plantAttacks: includePlantAttacks,
            },
            landIdsChecked: ownedLandIds.size,
            limit,
            plantIdsChecked: ownedPlantIds.size,
            summary: {
              ...summary,
              complete: !truncated,
              totalDisplay: truncated ? `at least ${summary.total}` : String(summary.total),
            },
            timeframeHours: cappedHours,
            toTimestamp: String(now),
            toTimestampIso: new Date(now * 1000).toISOString(),
            truncated,
            truncationNote: truncated
              ? 'Result reached the configured event limit. Treat counts as lower bounds and ask for a narrower time window for exact detail.'
              : null,
          };
        },
        readClient,
      ),
    }),

    get_transaction_status: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read a Base transaction receipt/status and summarize known Pixotchi logs. Never exposes calldata or prepares follow-up transactions.',
      inputSchema: z.object({
        txHash: TX_HASH_INPUT,
      }),
      execute: async ({ txHash }) => withToolResult(
        'get_transaction_status',
        `Base transaction receipt and known Pixotchi log reads via ${aiRpcSource}`,
        {
          confidence: 'medium',
          includeBlock: true,
          limitations: ['Calldata/input is intentionally not exposed.', 'Only logs from known Pixotchi contracts are summarized.'],
        },
        async () => {
          const hash = txHash as Hex;
          const [receiptResult, transactionResult] = await Promise.allSettled([
            readClient.getTransactionReceipt({ hash }),
            readClient.getTransaction({ hash }),
          ]);
          const receipt = receiptResult.status === 'fulfilled' ? receiptResult.value : null;
          const transaction = transactionResult.status === 'fulfilled' ? transactionResult.value : null;

          if (!receipt) {
            return {
              blockNumber: transaction?.blockNumber?.toString?.(),
              found: Boolean(transaction),
              from: transaction?.from,
              knownPixotchiEvents: [],
              status: transaction ? 'pending_or_unconfirmed' : 'not_found',
              to: transaction?.to,
              txHash,
              valueEth: transaction?.value !== undefined ? compactTokenAmount(formatToken(transaction.value)) : undefined,
            };
          }

          const block = receipt.blockNumber
            ? await readClient.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null)
            : null;
          const knownPixotchiEvents = summarizeKnownReceiptLogs(receipt.logs as readonly UntypedValue[]);

          return {
            blockNumber: receipt.blockNumber.toString(),
            found: true,
            from: receipt.from,
            gasUsed: receipt.gasUsed.toString(),
            knownPixotchiEvents,
            pixotchiLogCount: knownPixotchiEvents.length,
            status: receipt.status,
            timestamp: block?.timestamp?.toString?.(),
            to: receipt.to,
            txHash,
          };
        },
        readClient,
      ),
    }),

    get_activity: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read recent Pixotchi activity from the indexer. Use this for recent mints, attacks, quests, casino, building, and user activity questions.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        limit: z.number().int().min(1).max(20).default(10),
        scope: z.enum(['mine', 'global']).default('mine'),
      }),
      execute: async ({ address, limit, scope }) => withToolResult(
        'get_activity',
        scope === 'global' ? 'Ponder indexer global activity' : 'Ponder indexer user activity',
        { cache: scope === 'global' ? '3 seconds' : '5 seconds', includeBlock: false },
        async () => {
          const activities = scope === 'global'
            ? await getCachedAllActivity()
            : await getCachedMyActivity(getTargetAddress(address, context.userAddress));
          return {
            events: activities.slice(0, limit),
            limit,
            scope,
          };
        },
        readClient,
      ),
    }),

    get_game_prices: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read live Pixotchi prices and config: strain mint prices, land mint price, revive price, shop items, garden items, and fence pricing. Quote priceDisplay exactly because payment tokens can differ per item.',
      inputSchema: z.object({
        fenceDays: z.number().int().min(1).max(365).default(1),
        includeGardenItems: z.boolean().default(true),
        includeShopItems: z.boolean().default(true),
      }),
      execute: async ({ fenceDays, includeGardenItems, includeShopItems }) => withToolResult(
        'get_game_prices',
        `Base contract reads for Pixotchi NFT, Land, shop, garden, revive, and fence config via ${aiRpcSource}`,
        { includeBlock: true },
        async () => {
          const [
            strainsResult,
            landPriceResult,
            revivePriceResult,
            shopItemsResult,
            gardenItemsResult,
            fenceConfigResult,
            fenceQuoteResult,
          ] = await Promise.allSettled([
            getStrainInfo(readClient),
            getLandMintPrice(readClient),
            getRevivePrice(readClient),
            includeShopItems ? getShopItems(readClient) : Promise.resolve([]),
            includeGardenItems ? getAllGardenItems(readClient) : Promise.resolve([]),
            getFenceV2Config(readClient),
            quoteFenceV2(fenceDays, readClient),
          ]);

          const strains = strainsResult.status === 'fulfilled'
            ? strainsResult.value.map((strain) => {
              const paymentToken = strain.paymentToken || PIXOTCHI_TOKEN_ADDRESS;
              const rawPaymentPrice = strain.paymentPrice ?? parseUnits(String(strain.mintPrice), 18);
              const price = formatPriceFields(rawPaymentPrice, paymentToken);
              const availableSupply = strain.getStrainTotalLeft;
              const seedOnlyFields = isSeedToken(paymentToken)
                ? { mintPriceSeed: Number(price.priceAmount) }
                : {};

              return {
                active: strain.isActive,
                availableSupply,
                id: strain.id,
                isMintable: Boolean(strain.isActive && availableSupply > 0),
                maxSupply: strain.maxSupply,
                name: strain.name,
                paymentPrice: price.priceAmount,
                paymentToken: price.priceTokenAddress,
                priceAmount: price.priceAmount,
                priceDisplay: price.priceDisplay,
                priceTokenAddress: price.priceTokenAddress,
                priceTokenSymbol: price.priceTokenSymbol,
                remainingSupply: availableSupply,
                totalMinted: strain.totalMinted,
                totalSupply: strain.totalSupply,
                ...seedOnlyFields,
              };
            })
            : [];

          const landMintPrice = landPriceResult.status === 'fulfilled'
            ? {
              ...formatPriceFields(landPriceResult.value, PIXOTCHI_TOKEN_ADDRESS),
              availableSupply: null,
              isMintable: true,
            }
            : null;
          const revivePrice = revivePriceResult.status === 'fulfilled'
            ? {
              ...formatPriceFields(revivePriceResult.value, PIXOTCHI_TOKEN_ADDRESS),
              availableSupply: null,
              isMintable: true,
            }
            : null;

          return {
            errors: [
              strainsResult.status === 'rejected' ? `strains: ${errorMessage(strainsResult.reason)}` : null,
              landPriceResult.status === 'rejected' ? `landMintPrice: ${errorMessage(landPriceResult.reason)}` : null,
              revivePriceResult.status === 'rejected' ? `revivePrice: ${errorMessage(revivePriceResult.reason)}` : null,
              shopItemsResult.status === 'rejected' ? `shopItems: ${errorMessage(shopItemsResult.reason)}` : null,
              gardenItemsResult.status === 'rejected' ? `gardenItems: ${errorMessage(gardenItemsResult.reason)}` : null,
              fenceConfigResult.status === 'rejected' ? `fenceConfig: ${errorMessage(fenceConfigResult.reason)}` : null,
              fenceQuoteResult.status === 'rejected' ? `fenceQuote: ${errorMessage(fenceQuoteResult.reason)}` : null,
            ].filter(Boolean),
            fence: {
              config: fenceConfigResult.status === 'fulfilled' && fenceConfigResult.value
                ? {
                  ...formatPriceFields(fenceConfigResult.value.pricePerDay, PIXOTCHI_TOKEN_ADDRESS, { suffix: '/day' }),
                  availableSupply: null,
                  isMintable: true,
                  maxDurationDays: fenceConfigResult.value.maxDurationDays,
                  minDurationDays: fenceConfigResult.value.minDurationDays,
                  pricePerDaySeed: formatToken(fenceConfigResult.value.pricePerDay),
                }
                : null,
              quoteDays: fenceDays,
              quote: fenceQuoteResult.status === 'fulfilled'
                ? {
                  ...formatPriceFields(fenceQuoteResult.value, PIXOTCHI_TOKEN_ADDRESS),
                  availableSupply: null,
                  isMintable: true,
                }
                : null,
              quoteSeed: fenceQuoteResult.status === 'fulfilled' ? formatToken(fenceQuoteResult.value) : null,
            },
            gardenItems: gardenItemsResult.status === 'fulfilled'
              ? gardenItemsResult.value.map((item) => {
                const price = formatPriceFields(item.price, PIXOTCHI_TOKEN_ADDRESS);
                return {
                  ...price,
                  availableSupply: null,
                  id: item.id,
                  isMintable: true,
                  name: item.name,
                  points: item.points,
                  priceSeed: price.priceAmount,
                  timeExtensionSeconds: item.timeExtension,
                };
              })
              : [],
            landMintPrice,
            landMintPriceSeed: landMintPrice?.priceAmount ?? null,
            revivePrice,
            revivePriceSeed: revivePrice?.priceAmount ?? null,
            shopItems: shopItemsResult.status === 'fulfilled'
              ? shopItemsResult.value.map((item) => {
                const price = formatPriceFields(item.price, PIXOTCHI_TOKEN_ADDRESS);
                return {
                  ...price,
                  availableSupply: null,
                  effectTimeSeconds: item.effectTime,
                  id: item.id,
                  isMintable: true,
                  name: item.name,
                  priceSeed: price.priceAmount,
                };
              })
              : [],
            strains,
          };
        },
        readClient,
      ),
    }),

    get_mint_availability: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read plant and land mint availability for a wallet: live strain prices/supply, land price/supply, wallet payment-token balances, and known mint allowances. Use for "can I mint", "what can this wallet afford", and mint troubleshooting. Read-only; never mints or prepares approvals.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        includeLand: z.boolean().default(true),
        includePlants: z.boolean().default(true),
      }),
      execute: async ({ address, includeLand, includePlants }) => withToolResult(
        'get_mint_availability',
        `Base contract reads for Pixotchi mint prices, supply, balances, and allowances via ${aiRpcSource}`,
        {
          confidence: 'medium',
          includeBlock: true,
          limitations: [
            'Read-only availability mirrors public contract state and known Pixotchi payment tokens.',
            'Minting, approvals, whitelist checks, and final gas/payment validation must happen in the Mint UI before signing.',
            'Allowances can change at any time; refresh before approving or minting.',
          ],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const errors: string[] = [];
          const [strainsResult, landPriceResult, seedBalanceResult, landSupplyResult, landAccessResult] = await Promise.allSettled([
            includePlants ? getStrainInfo(readClient) : Promise.resolve([]),
            includeLand ? getLandMintPrice(readClient) : Promise.resolve(BigInt(0)),
            getTokenBalance(target, readClient),
            includeLand
              ? Promise.all([
                readClient.readContract({ address: LAND_CONTRACT_ADDRESS, abi: landAbi as UntypedValue, functionName: 'totalSupply', args: [] }) as Promise<bigint>,
                readClient.readContract({ address: LAND_CONTRACT_ADDRESS, abi: landAbi as UntypedValue, functionName: 'maxSupply', args: [] }) as Promise<bigint>,
              ])
              : Promise.resolve([BigInt(0), BigInt(0)] as [bigint, bigint]),
            includeLand
              ? Promise.all([
                readClient.readContract({ address: LAND_CONTRACT_ADDRESS, abi: landAbi as UntypedValue, functionName: 'accessControlGetPaused', args: [] }) as Promise<boolean>,
                readClient.readContract({ address: LAND_CONTRACT_ADDRESS, abi: landAbi as UntypedValue, functionName: 'accessControlGetWhitelistOnly', args: [] }) as Promise<boolean>,
                readClient.readContract({ address: LAND_CONTRACT_ADDRESS, abi: landAbi as UntypedValue, functionName: 'accessControlGetWhitelistAddress', args: [target] }) as Promise<boolean>,
              ])
              : Promise.resolve([false, false, true] as [boolean, boolean, boolean]),
          ]);
          const strains = strainsResult.status === 'fulfilled' ? strainsResult.value : [];
          const seedBalance = seedBalanceResult.status === 'fulfilled' ? seedBalanceResult.value : BigInt(0);
          const tokenAddresses = new Set<`0x${string}`>([
            PIXOTCHI_TOKEN_ADDRESS,
            ...strains
              .map((strain) => strain.paymentToken || PIXOTCHI_TOKEN_ADDRESS)
              .filter((token): token is `0x${string}` => Boolean(token && isAddress(token))),
          ]);
          const tokenReads = await Promise.allSettled([...tokenAddresses].map(async (tokenAddress) => {
            const [balance, plantAllowance, landAllowance] = await Promise.all([
              getTokenBalanceForToken(target, tokenAddress, readClient),
              readErc20Allowance(readClient, tokenAddress, target, PIXOTCHI_NFT_ADDRESS).catch(() => BigInt(0)),
              includeLand ? readErc20Allowance(readClient, tokenAddress, target, LAND_CONTRACT_ADDRESS).catch(() => BigInt(0)) : Promise.resolve(BigInt(0)),
            ]);
            return {
              allowanceToLandRaw: landAllowance,
              allowanceToPlantRaw: plantAllowance,
              balanceRaw: balance,
              tokenAddress,
              tokenSymbol: getAIPriceTokenSymbol(tokenAddress),
            };
          }));
          const tokenState = new Map<string, UntypedValue>();

          for (const result of tokenReads) {
            if (result.status === 'fulfilled') {
              tokenState.set(result.value.tokenAddress.toLowerCase(), result.value);
            } else {
              errors.push(`tokenState: ${errorMessage(result.reason)}`);
            }
          }

          const plantStrains = includePlants
            ? strains.map((strain) => {
              const paymentToken = strain.paymentToken || PIXOTCHI_TOKEN_ADDRESS;
              const rawPaymentPrice = strain.paymentPrice ?? parseUnits(String(strain.mintPrice), 18);
              const token = tokenState.get(paymentToken.toLowerCase());
              const price = formatPriceFields(rawPaymentPrice, paymentToken);
              const remainingSupply = strain.getStrainTotalLeft;
              const balanceRaw = BigInt(token?.balanceRaw ?? 0);
              const allowanceRaw = BigInt(token?.allowanceToPlantRaw ?? 0);
              const enoughBalance = balanceRaw >= rawPaymentPrice;
              const enoughAllowance = allowanceRaw >= rawPaymentPrice;

              return {
                active: strain.isActive,
                allowanceDisplay: `${formatKnownTokenAmount(allowanceRaw, paymentToken)} ${price.priceTokenSymbol}`,
                allowanceEnough: enoughAllowance,
                balanceDisplay: `${formatKnownTokenAmount(balanceRaw, paymentToken)} ${price.priceTokenSymbol}`,
                enoughBalance,
                id: strain.id,
                isMintable: Boolean(strain.isActive && remainingSupply > 0 && enoughBalance && enoughAllowance),
                maxSupply: strain.maxSupply,
                name: strain.name,
                priceDisplay: price.priceDisplay,
                remainingSupply,
                totalMinted: strain.totalMinted,
              };
            })
            : [];
          const [landTotalSupply, landMaxSupply] = landSupplyResult.status === 'fulfilled'
            ? landSupplyResult.value
            : [BigInt(0), BigInt(0)];
          const [landPaused, landWhitelistOnly, landWhitelisted] = landAccessResult.status === 'fulfilled'
            ? landAccessResult.value
            : [false, false, true];
          const landPrice = landPriceResult.status === 'fulfilled' ? landPriceResult.value : BigInt(0);
          const seedState = tokenState.get(PIXOTCHI_TOKEN_ADDRESS.toLowerCase());
          const landAllowance = BigInt(seedState?.allowanceToLandRaw ?? 0);
          const enoughSeedForLand = seedBalance >= landPrice;
          const enoughLandAllowance = landAllowance >= landPrice;
          const landRemainingSupply = Number(landMaxSupply) > 0 ? Math.max(0, Number(landMaxSupply - landTotalSupply)) : null;
          const landCanMint = includeLand
            ? Boolean(!landPaused && (!landWhitelistOnly || landWhitelisted) && (landRemainingSupply == null || landRemainingSupply > 0) && enoughSeedForLand && enoughLandAllowance)
            : false;

          return {
            address: target,
            errors: [
              strainsResult.status === 'rejected' ? `strains: ${errorMessage(strainsResult.reason)}` : null,
              landPriceResult.status === 'rejected' ? `landPrice: ${errorMessage(landPriceResult.reason)}` : null,
              seedBalanceResult.status === 'rejected' ? `seedBalance: ${errorMessage(seedBalanceResult.reason)}` : null,
              landSupplyResult.status === 'rejected' ? `landSupply: ${errorMessage(landSupplyResult.reason)}` : null,
              landAccessResult.status === 'rejected' ? `landMintAccess: ${errorMessage(landAccessResult.reason)}` : null,
              ...errors,
            ].filter(Boolean),
            land: includeLand
              ? {
                allowanceDisplay: `${formatKnownTokenAmount(landAllowance, PIXOTCHI_TOKEN_ADDRESS)} SEED`,
                allowanceEnough: enoughLandAllowance,
                canMint: landCanMint,
                enoughBalance: enoughSeedForLand,
                maxSupply: Number(landMaxSupply),
                mintPaused: Boolean(landPaused),
                priceDisplay: `${formatToken(landPrice)} SEED`,
                remainingSupply: landRemainingSupply,
                totalSupply: Number(landTotalSupply),
                userBalanceDisplay: `${formatToken(seedBalance)} SEED`,
                whitelist: {
                  isWhitelisted: Boolean(landWhitelisted),
                  whitelistOnly: Boolean(landWhitelistOnly),
                },
              }
              : null,
            plantStrains,
            summary: {
              affordablePlantStrains: plantStrains.filter((strain) => strain.enoughBalance && strain.allowanceEnough && strain.active && strain.remainingSupply > 0).length,
              mintablePlantStrains: plantStrains.filter((strain) => strain.isMintable).length,
              plantStrainsChecked: plantStrains.length,
              landCanMint,
            },
            ui: {
              mintWhere: 'Open Mint, review the visible price and approval prompts, then sign only from the app UI.',
            },
          };
        },
        readClient,
      ),
    }),

    get_lands: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read Pixotchi land NFTs, buildings, production, warehouse balances, barracks, casino/building status, and quest slots.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        includeBuildings: z.boolean().default(true),
        includeQuests: z.boolean().default(true),
        landIds: z.array(z.number().int().min(0)).max(20).optional(),
        limit: z.number().int().min(1).max(25).default(10),
      }),
      execute: async ({ address, includeBuildings, includeQuests, landIds, limit }) => withToolResult(
        'get_lands',
        `Base contract reads for Pixotchi Land and land modules via ${aiRpcSource}`,
        { includeBlock: true },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const allLands = await readLandsForInput(target, landIds, readClient);
          const lands = allLands.slice(0, limit);
          const buildingAggregateLands = includeBuildings
            ? allLands.slice(0, MAX_BUILDING_AGGREGATE_LANDS)
            : [];
          const buildingAggregateIds = buildingAggregateLands.map((land) => land.tokenId);
          const buildingResults = includeBuildings
            ? await getLandBuildingsBatch(buildingAggregateIds, { readClient })
            : [];
          const buildingMap = new Map(buildingResults.map((entry) => [entry.landId.toString(), entry]));

          const details = await Promise.all(lands.map(async (land) => {
            const key = land.tokenId.toString();
            const buildings = buildingMap.get(key);
            const [barracks, quests] = await Promise.all([
              includeBuildings ? barracksGetLandStateV2(land.tokenId, readClient) : Promise.resolve(null),
              includeQuests ? getQuestSlotsByLandId(land.tokenId, readClient).catch(() => []) : Promise.resolve([]),
            ]);
            return normalizeLand(land, {
              barracks,
              quests,
              townBuildings: buildings?.townBuildings ?? [],
              villageBuildings: buildings?.villageBuildings ?? [],
            });
          }));

          return {
            address: target,
            buildingProductionTotals: includeBuildings
              ? {
                ...summarizeBuildings(buildingResults),
                aggregatedLandCount: buildingResults.length,
                aggregationLimit: MAX_BUILDING_AGGREGATE_LANDS,
                truncated: allLands.length > buildingResults.length,
              }
              : null,
            count: details.length,
            lands: details,
            totalOwned: landIds?.length ? undefined : allLands.length,
            truncated: allLands.length > details.length,
            warehouseTotals: {
              storedLifetimeHours: allLands.reduce((sum, land) => sum + toNumber(land.accumulatedPlantLifetime), 0) / 3600,
              storedLifetimeSeconds: allLands.reduce((sum, land) => sum + toNumber(land.accumulatedPlantLifetime), 0),
              storedPts: allLands.reduce((sum, land) => sum + toNumber(land.accumulatedPlantPoints, 12), 0),
            },
          };
        },
        readClient,
      ),
    }),

    get_quest_readiness: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read Farmer House quest readiness for owned or selected lands: Farmer House level, quest slot statuses, timers, rewards-pool pause state, and next in-app actions. Use for quests, Farmer House, "can I send a quest", or daily quest readiness.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        landIds: z.array(z.number().int().min(0)).max(50).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ address, landIds, limit }) => withToolResult(
        'get_quest_readiness',
        `Base contract reads for Farmer House quest slots and rewards-pool balance via ${aiRpcSource}`,
        {
          confidence: 'medium',
          includeBlock: true,
          limitations: [
            `Scans at most ${AI_QUEST_READINESS_MAX_LANDS} lands per request unless narrowed by land IDs.`,
            'Quest slot state can change after every block; refresh the Farmer House UI before signing.',
            'Neural Seed cannot start, return, or finalize quests.',
          ],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const allLands = await readLandsForInput(target, landIds, readClient);
          const scannedLands = allLands.slice(0, Math.min(allLands.length, AI_QUEST_READINESS_MAX_LANDS));
          const displayLimit = Math.min(limit, scannedLands.length);
          const [currentBlock, rewardsBalance, buildingResults] = await Promise.all([
            readClient.getBlockNumber(),
            getTokenBalanceForToken(QUEST_REWARDS_WALLET, PIXOTCHI_TOKEN_ADDRESS, readClient).catch(() => BigInt(0)),
            getLandBuildingsBatch(scannedLands.map((land) => land.tokenId), { readClient }),
          ]);
          const buildingMap = new Map(buildingResults.map((entry) => [entry.landId.toString(), entry]));
          const rewardsPoolLow = rewardsBalance < MIN_QUEST_REWARDS_SEED_BALANCE;
          const questLands = await Promise.all(scannedLands.slice(0, displayLimit).map(async (land) => {
            const buildings = buildingMap.get(land.tokenId.toString());
            const farmerHouseLevel = getBuiltTownBuildingLevel(buildings, 7);
            const slots = farmerHouseLevel > 0
              ? await getQuestSlotsByLandId(land.tokenId, readClient).catch(() => [])
              : [];
            const normalizedSlots = slots
              .slice(0, Math.min(Math.max(farmerHouseLevel, 0), 3))
              .map((slot, index) => normalizeQuestSlot(slot, index, currentBlock));
            const availableSlots = normalizedSlots.filter((slot) => slot.status === 'available').length;
            const actionableSlots = normalizedSlots.filter((slot) => slot.status === 'ready_to_commit' || slot.status === 'committed').length;

            return {
              coordinates: {
                x: Number(land.coordinateX),
                y: Number(land.coordinateY),
              },
              farmerHouse: {
                built: farmerHouseLevel > 0,
                level: farmerHouseLevel,
                maxSlots: Math.min(Math.max(farmerHouseLevel, 0), 3),
              },
              id: land.tokenId.toString(),
              name: land.name || `Land #${land.tokenId.toString()}`,
              nextActions: [
                farmerHouseLevel <= 0 ? 'Build Farmer House from the Town buildings panel to unlock quests.' : null,
                rewardsPoolLow && availableSlots > 0 ? 'Wait for the Farmer House rewards wallet refill before starting new quests.' : null,
                actionableSlots > 0 ? 'Open Farmer House and use Return now or Open now on ready slots.' : null,
                !rewardsPoolLow && availableSlots > 0 ? 'Open Farmer House and start an Easy, Med, or Hard quest from an available slot.' : null,
              ].filter(Boolean),
              slots: normalizedSlots,
              summary: {
                actionableSlots,
                availableSlots,
                inProgressSlots: normalizedSlots.filter((slot) => slot.status === 'in_progress').length,
                totalSlots: normalizedSlots.length,
              },
            };
          }));
          const totals = questLands.reduce(
            (sum, land) => {
              sum.actionableSlots += land.summary.actionableSlots;
              sum.availableSlots += land.summary.availableSlots;
              sum.farmerHouseLands += land.farmerHouse.built ? 1 : 0;
              sum.inProgressSlots += land.summary.inProgressSlots;
              sum.totalSlots += land.summary.totalSlots;
              return sum;
            },
            {
              actionableSlots: 0,
              availableSlots: 0,
              farmerHouseLands: 0,
              inProgressSlots: 0,
              totalSlots: 0,
            },
          );

          return {
            address: target,
            currentBlock: currentBlock.toString(),
            landFilterApplied: Boolean(landIds?.length),
            lands: questLands,
            ownedLandCount: landIds?.length ? undefined : allLands.length,
            rewardsPool: {
              low: rewardsPoolLow,
              minimumSeedBalanceDisplay: `${formatToken(MIN_QUEST_REWARDS_SEED_BALANCE)} SEED`,
              wallet: QUEST_REWARDS_WALLET,
              walletBalanceDisplay: `${formatToken(rewardsBalance)} SEED`,
            },
            scannedLandCount: scannedLands.length,
            totals,
            truncated: allLands.length > scannedLands.length || scannedLands.length > questLands.length,
          };
        },
        readClient,
      ),
    }),

    get_leaderboards: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read Pixotchi leaderboards: plant PTS, land XP, staked SEED, mission points, and streaks. Use only when the user asks about rankings or leaderboard standings.',
      inputSchema: z.object({
        boards: z.array(z.enum(['plants', 'lands', 'stake', 'missions', 'streaks'])).default(['plants', 'lands']),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async ({ boards, limit }) => withToolResult(
        'get_leaderboards',
        `Base contract reads and Redis leaderboard stores via ${aiRpcSource}`,
        { cache: 'Stake leaderboard may be cached by its service; gamification leaderboards are Redis-backed.', includeBlock: true },
        async () => {
          const output: Record<string, UntypedValue> = {};

          if (boards.includes('plants')) {
            const ids = await getAliveTokenIds(readClient);
            const plants = await getPlantsInfoExtended(ids, readClient);
            output.plants = plants
              .sort((a, b) => b.score - a.score)
              .slice(0, limit)
              .map((plant, index) => ({
                id: plant.id,
                name: plant.name || `Plant #${plant.id}`,
                rank: index + 1,
                scorePts: plant.score / 1e12,
                status: statusLabel(plant.status, plant.statusStr),
                strain: PLANT_STRAINS_BY_ID[plant.strain]?.name || `Strain ${plant.strain}`,
              }));
          }

          if (boards.includes('lands')) {
            const lands = await getLandLeaderboard(readClient);
            output.lands = lands
              .sort((a: LandLeaderboardEntry, b: LandLeaderboardEntry) => Number(b.experiencePoints - a.experiencePoints))
              .slice(0, limit)
              .map((land, index) => ({
                experiencePoints: formatToken(land.experiencePoints),
                landId: land.landId,
                name: land.name || `Land #${land.landId}`,
                owner: land.owner,
                rank: index + 1,
              }));
          }

          if (boards.includes('stake')) {
            const stake = await getStakeLeaderboard(readClient);
            output.stake = stake.slice(0, limit);
          }

          if (boards.includes('missions') || boards.includes('streaks')) {
            const gm = await getLeaderboards();
            if (boards.includes('missions')) output.missions = gm.missionTop.slice(0, limit);
            if (boards.includes('streaks')) output.streaks = gm.streakTop.slice(0, limit);
          }

          return output;
        },
        readClient,
      ),
    }),

    get_attack_targets: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read current plant attack eligibility using the same Ranking UI guardrails: owned attackers, public leaderboard targets, attacker/target cooldowns, target fences, ownership, alive/dead state, and level rules. Use for "who can I attack right now" or eligible plant target questions.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        limit: z.number().int().min(1).max(20).default(10),
        scanLimit: z.number().int().min(20).max(500).default(200),
      }),
      execute: async ({ address, limit, scanLimit }) => withToolResult(
        'get_attack_targets',
        `Base contract reads for owned Pixotchi plants and public plant leaderboard via ${aiRpcSource}`,
        {
          confidence: 'medium',
          includeBlock: true,
          limitations: [
            'Read-only eligibility mirrors current app UI guardrails and does not guarantee transaction success.',
            'Targets are scanned from the current plant leaderboard up to scanLimit; use the Ranking tab for the final live attack button.',
            'The AI cannot execute attacks or choose a transaction for the player.',
          ],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const [ownedPlants, allPlantIds] = await Promise.all([
            readPlantsForAddress(target, readClient),
            getAliveTokenIds(readClient),
          ]);
          const leaderboardPlants = await getPlantsInfoExtended(allPlantIds, readClient);
          const owned = ownedPlants.map(normalizePlant);
          const ownedIds = new Set(owned.map((plant) => plant.id));
          const ranked = leaderboardPlants
            .map(normalizePlant)
            .sort((a, b) => b.scorePts - a.scorePts)
            .map((plant, index) => ({
              ...plant,
              rank: index + 1,
            }));
          const scanned = ranked.slice(0, scanLimit);
          const readyAttackers = owned.filter((plant) =>
            plant.status !== 4 && cooldownDetails(plant.lastAttackUsed, PLANT_ATTACK_ATTACKER_COOLDOWN_SECONDS).available
          );
          const blockedSummary = {
            deadTargets: 0,
            noLowerLevelReadyAttacker: 0,
            ownPlants: 0,
            protectedByFence: 0,
            targetCooldown: 0,
          };
          const targets: UntypedValue[] = [];

          for (const candidate of scanned) {
            const isOwn = ownedIds.has(candidate.id) || sameAddress(candidate.owner, target);
            const targetCooldown = cooldownDetails(candidate.lastAttacked, PLANT_ATTACK_TARGET_COOLDOWN_SECONDS);

            if (isOwn) {
              blockedSummary.ownPlants += 1;
              continue;
            }
            if (candidate.status === 4) {
              blockedSummary.deadTargets += 1;
              continue;
            }
            if (candidate.fence.active) {
              blockedSummary.protectedByFence += 1;
              continue;
            }
            if (!targetCooldown.available) {
              blockedSummary.targetCooldown += 1;
              continue;
            }

            const eligibleAttackers = readyAttackers.filter((attacker) =>
              attacker.id !== candidate.id && attacker.level < candidate.level
            );

            if (eligibleAttackers.length === 0) {
              blockedSummary.noLowerLevelReadyAttacker += 1;
              continue;
            }

            targets.push({
              eligibleAttackers: eligibleAttackers.slice(0, 5).map((attacker) => ({
                ...summarizeAttackPlant(attacker),
                attackerCooldown: cooldownDetails(attacker.lastAttackUsed, PLANT_ATTACK_ATTACKER_COOLDOWN_SECONDS),
              })),
              rank: candidate.rank,
              target: summarizeAttackPlant(candidate),
              targetCooldown,
            });
          }

          return {
            address: target,
            blockedSummary,
            eligibleTargetCount: targets.length,
            ownedPlantCount: owned.length,
            readyAttackerCount: readyAttackers.length,
            readyAttackers: readyAttackers.slice(0, 10).map((attacker) => ({
              ...summarizeAttackPlant(attacker),
              attackerCooldown: cooldownDetails(attacker.lastAttackUsed, PLANT_ATTACK_ATTACKER_COOLDOWN_SECONDS),
            })),
            rules: [
              'Attack is separate from dead-plant kill.',
              'Attacker must be alive.',
              'Target must be alive.',
              'Attacker level must be lower than target level.',
              'Each attacker can attack once every 30 minutes.',
              'A target can be attacked again after 60 minutes.',
              'Targets with an active fence/shield cannot be attacked.',
              'You cannot attack your own plant.',
              'Attacks are PTS combat: attacker has a 31% win chance and 69% loss chance.',
              'Winner gains 0.5% of the loser score, and loser loses that PTS.',
              'Attacks do not reduce TOD, lifetime, or starving timers.',
            ],
            scannedLeaderboardCount: scanned.length,
            targetCooldownSeconds: PLANT_ATTACK_TARGET_COOLDOWN_SECONDS,
            targets: targets.slice(0, limit),
            totalLeaderboardPlants: ranked.length,
            truncated: targets.length > limit || ranked.length > scanned.length,
          };
        },
        readClient,
      ),
    }),

    get_killable_plants: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read current dead-plant kill eligibility for collecting a star: dead targets, owned living killer plants, and the wallet kill cooldown. Use for "can I kill", "which plant can I kill", "collect a star by killing a plant", or dead leaderboard kill questions. This is separate from attacks.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        limit: z.number().int().min(1).max(20).default(10),
        scanLimit: z.number().int().min(20).max(500).default(500),
      }),
      execute: async ({ address, limit, scanLimit }) => withToolResult(
        'get_killable_plants',
        `Base contract reads for owned Pixotchi plants, dead leaderboard targets, and wallet kill cooldown via ${aiRpcSource}`,
        {
          confidence: 'medium',
          includeBlock: true,
          limitations: [
            'Read-only eligibility mirrors current app UI guardrails and does not guarantee transaction success.',
            'Dead targets are scanned from the current plant leaderboard up to scanLimit; use Ranking -> Dead for the final live kill button.',
            'The AI cannot execute kills or choose a transaction for the player.',
          ],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const [ownedPlants, allPlantIds, killCooldown] = await Promise.all([
            readPlantsForAddress(target, readClient),
            getAliveTokenIds(readClient),
            readKillCooldownForWallet(target, readClient),
          ]);
          const leaderboardPlants = await getPlantsInfoExtended(allPlantIds, readClient);
          const owned = ownedPlants.map(normalizePlant);
          const ownedIds = new Set(owned.map((plant) => plant.id));
          const livingKillerPlants = owned.filter((plant) => plant.status !== 4);
          const ranked = leaderboardPlants
            .map(normalizePlant)
            .sort((a, b) => b.scorePts - a.scorePts)
            .map((plant, index) => ({
              ...plant,
              rank: index + 1,
            }));
          const scanned = ranked.slice(0, scanLimit);
          let ownDeadTargets = 0;
          const deadTargets: UntypedValue[] = [];

          for (const candidate of scanned) {
            if (candidate.status !== 4) {
              continue;
            }

            const isOwn = ownedIds.has(candidate.id) || sameAddress(candidate.owner, target);
            if (isOwn) {
              ownDeadTargets += 1;
              continue;
            }

            deadTargets.push({
              rank: candidate.rank,
              rewardStars: 1,
              target: summarizeAttackPlant(candidate),
            });
          }

          return {
            address: target,
            blockedSummary: {
              noDeadTargets: deadTargets.length === 0,
              noLivingKillerPlant: livingKillerPlants.length === 0,
              ownDeadTargets,
              walletCooldown: killCooldown.canKill === false,
            },
            deadTargetCount: deadTargets.length,
            killCooldown,
            livingKillerCount: livingKillerPlants.length,
            livingKillerPlants: livingKillerPlants.slice(0, 10).map(summarizeAttackPlant),
            ownedPlantCount: owned.length,
            readiness: {
              canKillNow: killCooldown.canKill === true && livingKillerPlants.length > 0 && deadTargets.length > 0,
              hasDeadTargets: deadTargets.length > 0,
              hasLivingKillerPlant: livingKillerPlants.length > 0,
              walletCooldownReady: killCooldown.canKill,
            },
            rules: [
              'Kill is separate from attack.',
              'Target must already be dead.',
              'Killer plant must be one of your living plants.',
              'You cannot kill your own dead plant from the public dead-target flow.',
              'Wallet kill cooldown is once per hour.',
              'Killing grants exactly 1 star to the selected living plant and removes/burns the dead target.',
              'Killing does not use attack odds, does not transfer PTS between attacker/target, and does not reduce TOD/lifetime.',
            ],
            scannedLeaderboardCount: scanned.length,
            targets: deadTargets.slice(0, limit),
            totalLeaderboardPlants: ranked.length,
            truncated: deadTargets.length > limit || ranked.length > scanned.length,
          };
        },
        readClient,
      ),
    }),

    get_land_raid_targets: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read land Barracks raid eligibility for owned lands: built Barracks, troops, cooldowns, eligible defender land IDs, and optional read-only raid previews. Use for land raids, Barracks targets, troop readiness, or "who can I raid".',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        attackerLandIds: z.array(z.number().int().min(0)).max(20).optional(),
        includePreviews: z.boolean().default(true),
        limit: z.number().int().min(1).max(30).default(10),
        phalanxToSend: z.number().int().min(0).max(100000).optional(),
        previewTargetLimit: z.number().int().min(0).max(10).default(3),
        swordsmenToSend: z.number().int().min(0).max(100000).optional(),
      }),
      execute: async ({ address, attackerLandIds, includePreviews, limit, phalanxToSend, previewTargetLimit, swordsmenToSend }) => withToolResult(
        'get_land_raid_targets',
        `Base contract reads for Land Barracks V2 via ${aiRpcSource}`,
        {
          confidence: 'medium',
          includeBlock: true,
          limitations: [
            'Read-only eligibility mirrors the Barracks UI and does not guarantee transaction success.',
            'Raid previews are informational only; Neural Seed never executes raids or builds transaction payloads.',
            'If no troop count is supplied, previews use a tiny sample troop count only to test mechanics, not a recommendation.',
          ],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const allLands = await getLandsByOwner(target, readClient);
          const requestedIds = attackerLandIds?.length ? new Set(attackerLandIds.map(String)) : null;
          const selectedLands = allLands
            .filter((land) => !requestedIds || requestedIds.has(land.tokenId.toString()))
            .slice(0, Math.max(limit, attackerLandIds?.length || 0, 20));
          const [config, states] = await Promise.all([
            barracksGetConfigV2(),
            Promise.all(selectedLands.map((land) => barracksGetLandStateV2(land.tokenId, readClient))),
          ]);
          const readyAttackers: UntypedValue[] = [];
          const blocked = {
            attackCooldown: 0,
            noBarracks: 0,
            noTroops: 0,
          };

          for (const [index, land] of selectedLands.entries()) {
            const state = states[index];
            const raidState = normalizeBarracksForRaid(state);
            if (!state?.isBuilt) {
              blocked.noBarracks += 1;
              continue;
            }
            if ((Number(state.totalSwordsmanTroops) + Number(state.totalPhalanxTroops)) <= 0) {
              blocked.noTroops += 1;
              continue;
            }
            if (!raidState.attackReady) {
              blocked.attackCooldown += 1;
              continue;
            }
            readyAttackers.push({
              coordinates: {
                x: Number(land.coordinateX),
                y: Number(land.coordinateY),
              },
              id: land.tokenId.toString(),
              name: land.name || `Land #${land.tokenId.toString()}`,
              raidState,
              storedLifetimeHours: toNumber(land.accumulatedPlantLifetime) / 3600,
              storedPts: formatPts(land.accumulatedPlantPoints),
            });
          }

          const attackerResults = await Promise.all(readyAttackers.slice(0, limit).map(async (attacker) => {
            const attackerId = BigInt(String(attacker.id));
            const state = states[selectedLands.findIndex((land) => land.tokenId.toString() === attacker.id)];
            const eligibleIds = await barracksGetEligibleAttackableLandIds(attackerId);
            const targetIds = eligibleIds.slice(0, limit);
            const targetLands = targetIds.length
              ? await getLandsByIds(targetIds, { readClient })
              : [];
            const previewSwordsmen = swordsmenToSend === undefined
              ? (state && state.totalSwordsmanTroops > BigInt(0) ? BigInt(1) : BigInt(0))
              : BigInt(swordsmenToSend);
            const previewPhalanx = phalanxToSend === undefined
              ? (previewSwordsmen > BigInt(0) ? BigInt(0) : (state && state.totalPhalanxTroops > BigInt(0) ? BigInt(1) : BigInt(0)))
              : BigInt(phalanxToSend);
            const previewTargets = includePreviews && (previewSwordsmen + previewPhalanx) > BigInt(0)
              ? targetLands.slice(0, previewTargetLimit)
              : [];
            const previews = await Promise.all(previewTargets.map(async (defender) => ({
              defenderLandId: defender.tokenId.toString(),
              preview: summarizeRaidPreview(await barracksPreviewRaidV2(attackerId, defender.tokenId, previewSwordsmen, previewPhalanx)),
            })));

            return {
              attacker,
              eligibleTargetCount: eligibleIds.length,
              previewTroopsUsed: includePreviews
                ? {
                  phalanx: previewPhalanx.toString(),
                  sampleOnlyWhenNotUserProvided: phalanxToSend === undefined && swordsmenToSend === undefined,
                  swordsmen: previewSwordsmen.toString(),
                }
                : null,
              previews,
              targets: targetLands.slice(0, limit).map((land) => ({
                coordinates: {
                  x: Number(land.coordinateX),
                  y: Number(land.coordinateY),
                },
                id: land.tokenId.toString(),
                name: land.name || `Land #${land.tokenId.toString()}`,
                owner: land.owner,
                storedLifetimeHours: toNumber(land.accumulatedPlantLifetime) / 3600,
                storedPts: formatPts(land.accumulatedPlantPoints),
              })),
              truncated: eligibleIds.length > limit,
            };
          }));

          return {
            address: target,
            barracksConfig: config
              ? {
                attackCooldownSeconds: config.attackCooldown.toString(),
                buildCost: formatKnownTokenAmount(config.buildCost, config.buildToken),
                buildToken: getAIPriceTokenSymbol(config.buildToken),
                defenseCooldownSeconds: config.defenseCooldown.toString(),
                enabled: config.enabled,
                initialized: config.initialized,
                lootPercentageBps: config.lootPercentageBps,
                phalanx: {
                  maxTroopsPerLand: config.phalanx.maxTroopsPerLand.toString(),
                  trainingCost: formatKnownTokenAmount(config.phalanx.trainingCost, config.phalanx.trainingToken),
                  trainingToken: getAIPriceTokenSymbol(config.phalanx.trainingToken),
                  trainingTimePerTroopSeconds: config.phalanx.trainingTimePerTroop.toString(),
                },
                swordsman: {
                  maxTroopsPerLand: config.swordsman.maxTroopsPerLand.toString(),
                  trainingCost: formatKnownTokenAmount(config.swordsman.trainingCost, config.swordsman.trainingToken),
                  trainingToken: getAIPriceTokenSymbol(config.swordsman.trainingToken),
                  trainingTimePerTroopSeconds: config.swordsman.trainingTimePerTroop.toString(),
                },
              }
              : null,
            blocked,
            checkedLandCount: selectedLands.length,
            ownedLandCount: allLands.length,
            readyAttackerCount: readyAttackers.length,
            results: attackerResults,
            rules: [
              'The attacking land must own a built Barracks.',
              'The attacking land must have stationed or ready troops.',
              'The attacking land must be past its attack cooldown.',
              'Defender eligibility comes from the Barracks contract, not from leaderboard guesses.',
            ],
            truncated: readyAttackers.length > limit || selectedLands.length < allLands.length,
          };
        },
        readClient,
      ),
    }),

    get_land_raid_reports: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read the latest incoming and outgoing Barracks raid reports for owned or selected lands. Use for "who raided me", "what happened in my last raid", land raid history/report questions, and post-raid summaries. Read-only.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        landIds: z.array(z.number().int().min(0)).max(50).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ address, landIds, limit }) => withToolResult(
        'get_land_raid_reports',
        `Base contract reads for latest Barracks incoming/outgoing raid reports via ${aiRpcSource}`,
        {
          confidence: 'medium',
          includeBlock: true,
          limitations: [
            `Scans at most ${AI_LAND_RAID_REPORT_MAX_LANDS} lands per request unless narrowed by land IDs.`,
            'This returns the latest report stored onchain per land and direction, not a full historical event archive.',
            'Use combat activity for time-ranged indexed raid history.',
          ],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const allLands = await readLandsForInput(target, landIds, readClient);
          const scannedLands = allLands.slice(0, Math.min(allLands.length, AI_LAND_RAID_REPORT_MAX_LANDS));
          const lands = await Promise.all(scannedLands.slice(0, limit).map(async (land) => {
            const [outgoing, incoming] = await Promise.allSettled([
              readClient.readContract({
                address: LAND_CONTRACT_ADDRESS,
                abi: landAbi as UntypedValue,
                functionName: 'barracksGetLastOutgoingReportV2',
                args: [land.tokenId],
              }) as Promise<BarracksRaidReportV2>,
              readClient.readContract({
                address: LAND_CONTRACT_ADDRESS,
                abi: landAbi as UntypedValue,
                functionName: 'barracksGetLastIncomingReportV2',
                args: [land.tokenId],
              }) as Promise<BarracksRaidReportV2>,
            ]);

            return {
              coordinates: {
                x: Number(land.coordinateX),
                y: Number(land.coordinateY),
              },
              id: land.tokenId.toString(),
              incoming: incoming.status === 'fulfilled'
                ? summarizeBarracksReport(incoming.value, 'incoming')
                : null,
              name: land.name || `Land #${land.tokenId.toString()}`,
              outgoing: outgoing.status === 'fulfilled'
                ? summarizeBarracksReport(outgoing.value, 'outgoing')
                : null,
              readErrors: [
                outgoing.status === 'rejected' ? `outgoing: ${errorMessage(outgoing.reason)}` : null,
                incoming.status === 'rejected' ? `incoming: ${errorMessage(incoming.reason)}` : null,
              ].filter(Boolean),
            };
          }));
          const reports = lands.flatMap((land) => [
            land.outgoing ? { landId: land.id, landName: land.name, report: land.outgoing } : null,
            land.incoming ? { landId: land.id, landName: land.name, report: land.incoming } : null,
          ]).filter(Boolean);
          const latestReports = [...reports]
            .sort((a: UntypedValue, b: UntypedValue) => Number(b.report?.timestamp || 0) - Number(a.report?.timestamp || 0))
            .slice(0, limit);

          return {
            address: target,
            landFilterApplied: Boolean(landIds?.length),
            lands,
            latestReports,
            ownedLandCount: landIds?.length ? undefined : allLands.length,
            scannedLandCount: scannedLands.length,
            summary: {
              incomingReports: lands.filter((land) => land.incoming).length,
              latestReportTimestampIso: latestReports[0]?.report?.timestampIso ?? null,
              outgoingReports: lands.filter((land) => land.outgoing).length,
              totalReports: reports.length,
            },
            truncated: allLands.length > scannedLands.length || scannedLands.length > lands.length || reports.length > latestReports.length,
          };
        },
        readClient,
      ),
    }),

    get_land_production_audit: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Audit a wallet across many lands for Warehouse resources, unclaimed building production, daily PTS/TOD production, top claimable buildings, and land resource opportunities. Use for "total rewards across lands/plants", "what should I claim/apply", and large land-owner analysis.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        includePerBuilding: z.boolean().default(true),
        landIds: z.array(z.number().int().min(0)).max(100).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ address, includePerBuilding, landIds, limit }) => withToolResult(
        'get_land_production_audit',
        `Base contract reads for Land warehouse and building production via ${aiRpcSource}`,
        {
          confidence: 'high',
          includeBlock: true,
          limitations: [
            `Audits at most ${AI_LAND_PRODUCTION_AUDIT_MAX_LANDS} lands per request to keep AI usable for large wallets.`,
            'Production changes over time; refresh the Land UI before signing any claim/apply transaction.',
          ],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const allLands = await readLandsForInput(target, landIds, readClient);
          const auditedLands = allLands.slice(0, AI_LAND_PRODUCTION_AUDIT_MAX_LANDS);
          const buildingResults = await getLandBuildingsBatch(auditedLands.map((land) => land.tokenId), { readClient });
          const buildingTotals = getLandBuildingProductionTotals(buildingResults);
          const landsById = new Map(auditedLands.map((land) => [land.tokenId.toString(), land]));
          const enriched = buildingTotals.perLand.map((entry) => {
            const land = landsById.get(entry.landId);
            const buildings = entry.buildings
              .sort((a, b) => (b.accumulatedPoints - a.accumulatedPoints) || (b.accumulatedLifetimeSeconds - a.accumulatedLifetimeSeconds));
            return {
              buildingCount: entry.buildingCount,
              coordinates: land
                ? {
                  x: Number(land.coordinateX),
                  y: Number(land.coordinateY),
                }
                : null,
              id: entry.landId,
              name: land?.name || `Land #${entry.landId}`,
              productionLifetimePerDayHours: entry.productionLifetimePerDayHours,
              productionPtsPerDay: entry.productionPtsPerDay,
              storedLifetimeHours: land ? toNumber(land.accumulatedPlantLifetime) / 3600 : 0,
              storedPts: land ? formatPts(land.accumulatedPlantPoints) : '0',
              topUnclaimedBuildings: includePerBuilding ? buildings.slice(0, 5) : undefined,
              unclaimedLifetimeHours: entry.unclaimedLifetimeHours,
              unclaimedPts: entry.unclaimedPts,
            };
          });
          const topClaimable = [...enriched]
            .filter((land) => land.unclaimedPts > 0 || land.unclaimedLifetimeHours > 0)
            .sort((a, b) => (b.unclaimedPts - a.unclaimedPts) || (b.unclaimedLifetimeHours - a.unclaimedLifetimeHours))
            .slice(0, limit);
          const topProducers = [...enriched]
            .filter((land) => land.productionPtsPerDay > 0 || land.productionLifetimePerDayHours > 0)
            .sort((a, b) => (b.productionPtsPerDay - a.productionPtsPerDay) || (b.productionLifetimePerDayHours - a.productionLifetimePerDayHours))
            .slice(0, limit);

          return {
            address: target,
            auditedLandCount: auditedLands.length,
            buildingMix: summarizeBuildings(buildingResults),
            landFilterApplied: Boolean(landIds?.length),
            ownedLandCount: landIds?.length ? undefined : allLands.length,
            topClaimable,
            topProducers,
            totals: {
              buildingProduction: buildingTotals.totals,
              warehouseLifetimeHours: auditedLands.reduce((sum, land) => sum + toNumber(land.accumulatedPlantLifetime), 0) / 3600,
              warehouseLifetimeSeconds: auditedLands.reduce((sum, land) => sum + toNumber(land.accumulatedPlantLifetime), 0),
              warehousePts: auditedLands.reduce((sum, land) => sum + toNumber(land.accumulatedPlantPoints, 12), 0),
            },
            truncated: allLands.length > auditedLands.length || enriched.length > limit,
          };
        },
        readClient,
      ),
    }),

    get_casino_status: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read Casino/Roulette and Blackjack status for owned or selected lands: feature flags, supported betting tokens, bet limits, active roulette bets, blackjack snapshots, and casino-built lands. Use for casino, roulette, blackjack, stuck game, or wager availability questions.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        includeBlackjack: z.boolean().default(true),
        includeRoulette: z.boolean().default(true),
        landIds: z.array(z.number().int().min(0)).max(20).optional(),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async ({ address, includeBlackjack, includeRoulette, landIds, limit }) => withToolResult(
        'get_casino_status',
        `Base contract reads for Land Casino and Blackjack modules via ${aiRpcSource}`,
        {
          confidence: 'medium',
          includeBlock: true,
          limitations: [
            `Scans at most ${AI_CASINO_STATUS_MAX_LANDS} lands unless specific land IDs are supplied.`,
            'Roulette/Blackjack reads are current onchain snapshots; the game UI must refresh again before any transaction.',
            'Neural Seed cannot place bets, reveal games, hit/stand, or build transaction payloads.',
          ],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const allLands = await readLandsForInput(target, landIds, readClient);
          const scanLimit = landIds?.length ? allLands.length : Math.min(allLands.length, AI_CASINO_STATUS_MAX_LANDS);
          const scannedLands = allLands.slice(0, scanLimit);
          const buildingResults = await getLandBuildingsBatch(scannedLands.map((land) => land.tokenId), { readClient });
          const buildingMap = new Map(buildingResults.map((entry) => [entry.landId.toString(), entry]));
          const casinoLands = scannedLands.filter((land) => {
            const townBuildings = buildingMap.get(land.tokenId.toString())?.townBuildings || [];
            return townBuildings.some((building) => Number(building?.id ?? building?.[0] ?? 0) === 6 && Number(building?.level ?? building?.[1] ?? 0) > 0);
          });
          const [
            casinoBuildingConfig,
            casinoConfig,
            casinoSupportedTokens,
            blackjackConfig,
          ] = await Promise.all([
            casinoGetBuildingConfig(),
            includeRoulette ? casinoGetConfig() : Promise.resolve(null),
            includeRoulette ? casinoGetSupportedTokens() : Promise.resolve([]),
            includeBlackjack ? blackjackGetConfig() : Promise.resolve(null),
          ]);
          const supportedTokenConfigs = await Promise.all((casinoSupportedTokens || []).slice(0, 8).map(async (token) => ({
            casino: includeRoulette ? await casinoGetTokenConfig(token) : null,
            blackjack: includeBlackjack ? await blackjackGetTokenConfig(token) : null,
            token,
          })));
          const lands = await Promise.all(casinoLands.slice(0, limit).map(async (land) => {
            const [activeBet, rouletteStats, blackjackAvailable, blackjackToken, blackjackSnapshot, blackjackStats] = await Promise.all([
              includeRoulette ? casinoGetActiveBetV2(land.tokenId) : Promise.resolve(null),
              includeRoulette ? casinoGetStats(land.tokenId) : Promise.resolve(null),
              includeBlackjack ? blackjackIsAvailable(land.tokenId) : Promise.resolve(null),
              includeBlackjack ? blackjackGetGameToken(land.tokenId) : Promise.resolve(null),
              includeBlackjack ? blackjackGetGameSnapshot(land.tokenId) : Promise.resolve(null),
              includeBlackjack ? blackjackGetStats(land.tokenId) : Promise.resolve(null),
            ]);
            const blackjackBetToken = blackjackToken || blackjackConfig?.bettingToken;
            return {
              blackjack: includeBlackjack
                ? {
                  availability: blackjackAvailable,
                  gameToken: blackjackBetToken,
                  gameTokenSymbol: getAIPriceTokenSymbol(blackjackBetToken || undefined),
                  snapshot: normalizeBlackjackSnapshot(blackjackSnapshot, blackjackBetToken || undefined),
                  stats: normalizeCasinoStats(blackjackStats, blackjackBetToken || undefined),
                }
                : null,
              coordinates: {
                x: Number(land.coordinateX),
                y: Number(land.coordinateY),
              },
              id: land.tokenId.toString(),
              name: land.name || `Land #${land.tokenId.toString()}`,
              roulette: includeRoulette
                ? {
                  activeBet: normalizeCasinoActiveBet(activeBet),
                  stats: normalizeCasinoStats(rouletteStats, activeBet?.bettingToken || casinoConfig?.bettingToken),
                }
                : null,
            };
          }));

          return {
            address: target,
            configs: {
              blackjack: blackjackConfig
                ? {
                  bettingToken: blackjackConfig.bettingToken,
                  bettingTokenSymbol: getAIPriceTokenSymbol(blackjackConfig.bettingToken),
                  enabled: blackjackConfig.enabled,
                  maxBetDisplay: `${formatKnownTokenAmount(blackjackConfig.maxBet, blackjackConfig.bettingToken)} ${getAIPriceTokenSymbol(blackjackConfig.bettingToken)}`,
                  minBetDisplay: `${formatKnownTokenAmount(blackjackConfig.minBet, blackjackConfig.bettingToken)} ${getAIPriceTokenSymbol(blackjackConfig.bettingToken)}`,
                  requiredLevel: blackjackConfig.requiredLevel,
                }
                : null,
              casinoBuilding: casinoBuildingConfig
                ? {
                  buildingCostDisplay: `${formatKnownTokenAmount(casinoBuildingConfig.buildingCost, casinoBuildingConfig.buildingToken)} ${getAIPriceTokenSymbol(casinoBuildingConfig.buildingToken)}`,
                  buildingToken: casinoBuildingConfig.buildingToken,
                }
                : null,
              roulette: casinoConfig
                ? {
                  bettingToken: casinoConfig.bettingToken,
                  bettingTokenSymbol: getAIPriceTokenSymbol(casinoConfig.bettingToken),
                  enabled: casinoConfig.enabled,
                  maxBetDisplay: `${formatKnownTokenAmount(casinoConfig.maxBet, casinoConfig.bettingToken)} ${getAIPriceTokenSymbol(casinoConfig.bettingToken)}`,
                  maxBetsPerGame: casinoConfig.maxBetsPerGame.toString(),
                  minBetDisplay: `${formatKnownTokenAmount(casinoConfig.minBet, casinoConfig.bettingToken)} ${getAIPriceTokenSymbol(casinoConfig.bettingToken)}`,
                }
                : null,
              supportedTokens: supportedTokenConfigs.map(({ blackjack, casino, token }) => ({
                blackjack: blackjack
                  ? {
                    enabled: blackjack.enabled,
                    maxBetDisplay: `${formatKnownTokenAmount(blackjack.maxBet, token)} ${getAIPriceTokenSymbol(token)}`,
                    minBetDisplay: `${formatKnownTokenAmount(blackjack.minBet, token)} ${getAIPriceTokenSymbol(token)}`,
                    requiredLevel: blackjack.requiredLevel,
                    supported: blackjack.supported,
                  }
                  : null,
                roulette: casino
                  ? {
                    enabled: casino.enabled,
                    maxBetDisplay: `${formatKnownTokenAmount(casino.maxBet, token)} ${getAIPriceTokenSymbol(token)}`,
                    maxBetsPerGame: casino.maxBetsPerGame.toString(),
                    minBetDisplay: `${formatKnownTokenAmount(casino.minBet, token)} ${getAIPriceTokenSymbol(token)}`,
                    supported: casino.supported,
                  }
                  : null,
                token,
                tokenSymbol: getAIPriceTokenSymbol(token),
              })),
            },
            featureFlags: {
              blackjackEnabledInApp: CLIENT_ENV.BLACKJACK_ENABLED,
              casinoEnabledInApp: CLIENT_ENV.CASINO_ENABLED,
            },
            landFilterApplied: Boolean(landIds?.length),
            lands,
            ownedLandCount: landIds?.length ? undefined : allLands.length,
            scannedLandCount: scannedLands.length,
            totalCasinoLandsInScan: casinoLands.length,
            truncated: allLands.length > scannedLands.length || casinoLands.length > lands.length,
          };
        },
        readClient,
      ),
    }),

    get_blackjack_action_state: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read current Blackjack action availability for casino lands: active snapshot, action hand, and hit/stand/double/split/surrender/insurance flags. Use for "can I hit", "can I stand", "what blackjack actions are available", or stuck blackjack games. Read-only; never advises gambling strategy or executes actions.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        handIndex: z.number().int().min(0).max(1).optional(),
        landIds: z.array(z.number().int().min(0)).max(30).optional(),
        limit: z.number().int().min(1).max(30).default(10),
      }),
      execute: async ({ address, handIndex, landIds, limit }) => withToolResult(
        'get_blackjack_action_state',
        `Base contract reads for Casino building and Blackjack action state via ${aiRpcSource}`,
        {
          confidence: 'medium',
          includeBlock: true,
          limitations: [
            `Scans at most ${AI_BLACKJACK_ACTION_MAX_LANDS} lands unless specific land IDs are supplied.`,
            'This reports available button states only. It is not gambling, odds, or strategy advice.',
            'Neural Seed cannot hit, stand, double, split, surrender, place bets, or build transaction payloads.',
          ],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const allLands = await readLandsForInput(target, landIds, readClient);
          const scannedLands = allLands.slice(0, landIds?.length ? allLands.length : Math.min(allLands.length, AI_BLACKJACK_ACTION_MAX_LANDS));
          const buildingResults = await getLandBuildingsBatch(scannedLands.map((land) => land.tokenId), { readClient });
          const buildingMap = new Map(buildingResults.map((entry) => [entry.landId.toString(), entry]));
          const casinoLands = scannedLands.filter((land) => hasBuiltTownBuilding(buildingMap.get(land.tokenId.toString()), 6));
          const lands = await Promise.all(casinoLands.slice(0, limit).map(async (land) => {
            const [available, token, snapshot, stats] = await Promise.all([
              blackjackIsAvailable(land.tokenId),
              blackjackGetGameToken(land.tokenId),
              blackjackGetGameSnapshot(land.tokenId),
              blackjackGetStats(land.tokenId).catch(() => null),
            ]);
            const normalizedSnapshot = normalizeBlackjackSnapshot(snapshot, token || undefined);
            const selectedHandIndex = handIndex ?? normalizedSnapshot?.actionHandIndex ?? 0;
            const actions = await blackjackGetActions(land.tokenId, selectedHandIndex).catch(() => null);
            const availableActions = actions
              ? {
                canDouble: actions.canDouble,
                canHit: actions.canHit,
                canInsurance: actions.canInsurance,
                canSplit: actions.canSplit,
                canStand: actions.canStand,
                canSurrender: actions.canSurrender,
              }
              : normalizedSnapshot?.availableActions ?? null;
            const actionLabels = availableActions
              ? Object.entries(availableActions)
                .filter(([, value]) => Boolean(value))
                .map(([key]) => key.replace(/^can/, '').toLowerCase())
              : [];

            return {
              blackjackAvailability: available,
              coordinates: {
                x: Number(land.coordinateX),
                y: Number(land.coordinateY),
              },
              gameToken: token,
              gameTokenSymbol: getAIPriceTokenSymbol(token || undefined),
              id: land.tokenId.toString(),
              name: land.name || `Land #${land.tokenId.toString()}`,
              selectedHandIndex,
              snapshot: normalizedSnapshot,
              stats: normalizeCasinoStats(stats, token || undefined),
              ui: {
                actionLabels,
                nextStep: normalizedSnapshot?.isActive
                  ? 'Open the Blackjack dialog for this land and use only the enabled action buttons shown there.'
                  : 'No active blackjack hand was found for this land.',
              },
            };
          }));

          return {
            address: target,
            casinoLandCountInScan: casinoLands.length,
            handIndexRequested: handIndex ?? null,
            landFilterApplied: Boolean(landIds?.length),
            lands,
            ownedLandCount: landIds?.length ? undefined : allLands.length,
            scannedLandCount: scannedLands.length,
            summary: {
              activeGames: lands.filter((land) => land.snapshot?.isActive).length,
              landsWithAvailableActions: lands.filter((land) => land.ui.actionLabels.length > 0).length,
            },
            truncated: allLands.length > scannedLands.length || casinoLands.length > lands.length,
          };
        },
        readClient,
      ),
    }),

    get_marketplace_orders: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read the SEED/LEAF land marketplace order book and the wallet’s own public orders. Use for SEED/LEAF order book, best bid/ask, open order, or marketplace task questions. Read-only; never places or cancels orders.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        includeInactive: z.boolean().default(false),
        includeMyOrders: z.boolean().default(true),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ address, includeInactive, includeMyOrders, limit }) => withToolResult(
        'get_marketplace_orders',
        `Base contract reads for Land marketplace order book via ${aiRpcSource}`,
        {
          confidence: 'medium',
          includeBlock: true,
          limitations: [
            `Active order scan is capped to ${AI_MARKETPLACE_ORDER_SCAN_LIMIT} orders before compaction.`,
            'The marketplace UI must refresh the book and balances before signing create/take/cancel transactions.',
            'Neural Seed cannot place, take, cancel, approve, or build marketplace transactions.',
          ],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const [activeRaw, inactiveRaw, myRaw, activeFlag, ownedLands] = await Promise.all([
            readClient.readContract({ address: LAND_CONTRACT_ADDRESS, abi: landAbi as UntypedValue, functionName: 'marketPlaceGetActiveOrders', args: [] }) as Promise<UntypedValue[]>,
            includeInactive
              ? readClient.readContract({ address: LAND_CONTRACT_ADDRESS, abi: landAbi as UntypedValue, functionName: 'marketPlaceGetInactiveOrders', args: [] }) as Promise<UntypedValue[]>
              : Promise.resolve([]),
            includeMyOrders
              ? readClient.readContract({ address: LAND_CONTRACT_ADDRESS, abi: landAbi as UntypedValue, functionName: 'marketPlaceGetUserOrders', args: [target] }) as Promise<UntypedValue[]>
              : Promise.resolve([]),
            readClient.readContract({ address: LAND_CONTRACT_ADDRESS, abi: landAbi as UntypedValue, functionName: 'marketPlaceIsActive', args: [] }) as Promise<boolean>,
            getLandsByOwner(target, readClient).catch(() => []),
          ]);
          const activeOrders = (activeRaw || []).slice(0, AI_MARKETPLACE_ORDER_SCAN_LIMIT).map(normalizeMarketplaceOrder);
          const inactiveOrders = (inactiveRaw || []).slice(0, Math.min(limit, AI_MARKETPLACE_ORDER_SCAN_LIMIT)).map(normalizeMarketplaceOrder);
          const myOrders = (myRaw || []).slice(0, AI_MARKETPLACE_ORDER_SCAN_LIMIT).map(normalizeMarketplaceOrder);
          const book = summarizeOrderBook(activeOrders, limit);

          return {
            active: Boolean(activeFlag),
            address: target,
            orderBook: book,
            inactiveOrders: includeInactive ? inactiveOrders.slice(0, limit).map(compactMarketplaceOrder) : undefined,
            myOrders: includeMyOrders
              ? {
                active: myOrders.filter((order) => order.isActive).slice(0, limit).map(compactMarketplaceOrder),
                inactive: myOrders.filter((order) => !order.isActive).slice(0, limit).map(compactMarketplaceOrder),
                total: myOrders.length,
              }
              : undefined,
            rules: [
              'Order book price is shown as LEAF per SEED, matching the marketplace UI.',
              'sellToken=1 orders offer LEAF for SEED (asks).',
              'sellToken=0 orders offer SEED for LEAF (bids).',
              'Marketplace actions require an owned land in the UI.',
            ],
            userCanUseMarketplaceUi: ownedLands.length > 0,
            userOwnedLandCount: ownedLands.length,
            truncated: (activeRaw || []).length > activeOrders.length || myOrders.length > limit,
          };
        },
        readClient,
      ),
    }),

    get_claim_eligibility: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read public/authenticated claim availability for Base Verify free plant and wallet airdrop cards. Use for "can I claim", "airdrop", "verify", "free plant", or why a claim card is not showing. Never signs or claims.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
      }),
      execute: async ({ address }) => withToolResult(
        'get_claim_eligibility',
        'Redis-backed public airdrop status and Base Verify claim status, plus Base balance checks for public bonus availability',
        {
          cache: 'Current Redis claim state; bonus funding check is live when configured.',
          confidence: 'medium',
          includeBlock: true,
          limitations: [
            'Only returns the requested wallet’s claim status; it never lists other eligible wallets or admin airdrop data.',
            'The AI cannot verify social accounts, sign messages, submit claims, or expose claim/admin internals.',
          ],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const lower = target.toLowerCase();
          const [airdropRaw, verifyRaw] = await Promise.all([
            redis?.get(`airdrop:eligible:${lower}`),
            redis?.get(`wallet_claims:${lower}`),
          ]);
          const airdrop = safeJsonParse(airdropRaw);
          const verifyClaim = safeJsonParse(verifyRaw);
          const seedBonusEnabled = CLIENT_ENV.VERIFY_CLAIM_SEED_BONUS_ENABLED;
          const agentAddress = process.env.VERIFY_CLAIM_AGENT_ADDRESS || '';
          let seedBonusAvailable = false;

          if (seedBonusEnabled && agentAddress && isAddress(agentAddress)) {
            try {
              const seedBalance = await getTokenBalanceForToken(getAddress(agentAddress), PIXOTCHI_TOKEN_ADDRESS, readClient);
              seedBonusAvailable = seedBalance >= parseUnits(VERIFY_CLAIM_SEED_BONUS_AMOUNT, 18);
            } catch {
              seedBonusAvailable = false;
            }
          }

          return {
            address: target,
            airdrop: airdrop
              ? {
                claimed: Boolean(airdrop.claimed),
                claimedAt: airdrop.claimedAt || null,
                eligible: true,
                leaf: String(airdrop.leaf || '0'),
                pixotchi: String(airdrop.pixotchi || '0'),
                seed: String(airdrop.seed || '0'),
                txHash: typeof airdrop.txHash === 'string' ? airdrop.txHash : null,
              }
              : {
                claimed: false,
                eligible: false,
                leaf: '0',
                pixotchi: '0',
                seed: '0',
                txHash: null,
              },
            ui: {
              airdropWhere: 'Wallet Profile shows the Airdrop card when NEXT_PUBLIC_SHOW_AIRDROP is enabled and the wallet is eligible.',
              verifyWhere: 'Mint shows the Base Verify free-plant card when verify claims are enabled.',
            },
            verifyFreePlant: {
              bonuses: {
                leaf: CLIENT_ENV.VERIFY_CLAIM_LEAF_BONUS_ENABLED ? VERIFY_CLAIM_LEAF_BONUS_LABEL : null,
                seed: seedBonusAvailable ? VERIFY_CLAIM_SEED_BONUS_LABEL : null,
              },
              claimed: Boolean(verifyClaim),
              claimData: verifyClaim
                ? {
                  status: verifyClaim.status,
                  strainId: verifyClaim.strainId,
                  timestamp: verifyClaim.timestamp,
                  tokenId: verifyClaim.tokenId,
                }
                : null,
              enabled: CLIENT_ENV.VERIFY_CLAIM_ENABLED,
            },
          };
        },
        readClient,
      ),
    }),

    get_app_status: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read app/module health and public feature flags: app, RPC, indexer, database, notifications, Base status, casino, blackjack, barracks, swaps, verify, Solana bridge, and status staleness. Use when users ask if something is down or disabled.',
      inputSchema: z.object({
        forceRefresh: z.boolean().default(false),
      }),
      execute: async ({ forceRefresh }) => withToolResult(
        'get_app_status',
        'Pixotchi status checks, public app feature flags, and Solana bridge config validation',
        {
          cache: forceRefresh ? 'Forced refresh requested' : 'Cached status snapshot when available',
          confidence: 'medium',
          includeBlock: false,
          limitations: ['Status checks are operational diagnostics, not a guarantee that a future transaction will succeed.'],
        },
        async () => {
          const status = await getCachedStatusSnapshot(forceRefresh);
          const solanaValidation = validateSolanaConfig();
          return {
            featureFlags: {
              barracksEnabled: CLIENT_ENV.BARRACKS_ENABLED,
              barracksPreviewEnabled: CLIENT_ENV.BARRACKS_PREVIEW_ENABLED,
              barracksV2Enabled: CLIENT_ENV.BARRACKS_V2_ENABLED,
              blackjackEnabled: CLIENT_ENV.BLACKJACK_ENABLED,
              casinoEnabled: CLIENT_ENV.CASINO_ENABLED,
              gamificationDisabled: CLIENT_ENV.GAMIFICATION_DISABLED,
              paymasterEnabled: CLIENT_ENV.PAYMASTER_ENABLED,
              solanaEnabled: isSolanaEnabled(),
              swapDisabled: CLIENT_ENV.SWAP_MODULE_DISABLED,
              swapDisabledMessage: CLIENT_ENV.SWAP_MODULE_DISABLED ? CLIENT_ENV.SWAP_MODULE_DISABLED_MESSAGE : null,
              verifyClaimEnabled: CLIENT_ENV.VERIFY_CLAIM_ENABLED,
            },
            overall: status.overall,
            services: status.services.map((service) => ({
              details: service.details,
              id: service.id,
              label: service.label,
              latencyMs: service.latencyMs,
              status: service.status,
            })),
            solanaBridgeConfig: {
              enabled: isSolanaEnabled(),
              missingPublicConfig: solanaValidation.missing,
              validPublicConfig: solanaValidation.valid,
            },
            statusGeneratedAt: status.generatedAt,
          };
        },
        readClient,
      ),
    }),

    get_daily_task_plan: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read today’s Rocks/Farmer Tasks progress and combine it with live wallet state to suggest the most practical next incomplete tasks. Use for "what should I do next", "finish my daily", "Rocks", or onboarding task guidance.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        suggestionLimit: z.number().int().min(1).max(10).default(5),
      }),
      execute: async ({ address, suggestionLimit }) => withToolResult(
        'get_daily_task_plan',
        `Redis gamification state plus Base wallet/land/plant reads via ${aiRpcSource}`,
        {
          cache: 'Mission progress is Redis-backed; readiness is live onchain where possible.',
          confidence: 'medium',
          includeBlock: true,
          limitations: [
            'Mission completion can depend on proof indexing after transactions.',
            'Readiness suggestions are not transaction guarantees; use the visible Tasks and action panels before signing.',
          ],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const [mission, missionScore, streak, plants, lands, seedBalance, leafBalance, stake] = await Promise.all([
            getMissionDay(target),
            getMissionScore(target),
            getStreak(target),
            readPlantsForAddress(target, readClient),
            getLandsByOwner(target, readClient),
            getTokenBalance(target, readClient),
            getLeafBalance(target, readClient),
            getStakeComposite(target, readClient).catch(() => null),
          ]);
          const taskRows = buildMissionTaskRows(mission);
          const productionScanLands = lands.slice(0, Math.min(lands.length, 75));
          const buildingResults = productionScanLands.length
            ? await getLandBuildingsBatch(productionScanLands.map((land) => land.tokenId), { readClient })
            : [];
          const buildingTotals = getLandBuildingProductionTotals(buildingResults).totals;
          const casinoLandsInScan = buildingResults.filter((entry) =>
            (entry.townBuildings || []).some((building) => Number(building?.id ?? building?.[0] ?? 0) === 6 && Number(building?.level ?? building?.[1] ?? 0) > 0)
          ).length;
          const hasPlant = plants.length > 0;
          const hasLand = lands.length > 0;
          const hasSeed = seedBalance > BigInt(0);
          const hasLeaf = leafBalance > BigInt(0);
          const claimableStakeLeaf = stake?.stake?.rewards || BigInt(0);
          const warehousePts = lands.reduce((sum, land) => sum + toNumber(land.accumulatedPlantPoints, 12), 0);
          const warehouseLifetimeHours = lands.reduce((sum, land) => sum + toNumber(land.accumulatedPlantLifetime), 0) / 3600;
          const readiness: Record<string, { ready: boolean; reason: string; suggestedPanel: string }> = {
            s1_claim_stake: {
              ready: claimableStakeLeaf > BigInt(0),
              reason: claimableStakeLeaf > BigInt(0) ? `You have ${formatToken(claimableStakeLeaf)} LEAF claimable from staking.` : 'No claimable staking rewards were found.',
              suggestedPanel: 'Staking',
            },
            s1_make_swap: {
              ready: hasSeed || hasLeaf,
              reason: hasSeed || hasLeaf ? 'You have game tokens that can be used in the Swap panel.' : 'No SEED/LEAF balance was found for a simple in-game swap.',
              suggestedPanel: 'Swap',
            },
            s1_place_order: {
              ready: hasLand && (hasSeed || hasLeaf),
              reason: hasLand && (hasSeed || hasLeaf) ? 'You own land and have SEED/LEAF, so the marketplace panel can create an order.' : 'Marketplace orders require an owned land plus SEED or LEAF.',
              suggestedPanel: 'Land Marketplace',
            },
            s1_stake_seed: {
              ready: hasSeed,
              reason: hasSeed ? `You have ${formatToken(seedBalance)} SEED available.` : 'No SEED balance was found for staking.',
              suggestedPanel: 'Staking',
            },
            s2_chat_message: { ready: true, reason: 'Public chat is a UI action.', suggestedPanel: 'Public Chat' },
            s2_follow_player: { ready: true, reason: 'Follow a visible player from profile/social surfaces.', suggestedPanel: 'Profile/Social' },
            s2_visit_profile: { ready: true, reason: 'Visit any visible player profile.', suggestedPanel: 'Profile/Social' },
            s3_apply_resources: {
              ready: hasPlant && (warehousePts > 0 || warehouseLifetimeHours > 0),
              reason: hasPlant && (warehousePts > 0 || warehouseLifetimeHours > 0)
                ? `Warehouse has about ${warehousePts.toFixed(2)} PTS and ${warehouseLifetimeHours.toFixed(2)} TOD hours available across lands.`
                : 'Applying resources requires a plant and Warehouse resources.',
              suggestedPanel: 'Land/Warehouse',
            },
            s3_claim_production: {
              ready: buildingTotals.unclaimedPts > 0 || buildingTotals.unclaimedLifetimeHours > 0,
              reason: buildingTotals.unclaimedPts > 0 || buildingTotals.unclaimedLifetimeHours > 0
                ? `Scanned buildings have about ${buildingTotals.unclaimedPts.toFixed(2)} PTS and ${buildingTotals.unclaimedLifetimeHours.toFixed(2)} TOD hours unclaimed.`
                : 'No unclaimed building production was found in the scanned lands.',
              suggestedPanel: 'Land Buildings',
            },
            s3_play_casino_game: {
              ready: CLIENT_ENV.CASINO_ENABLED && casinoLandsInScan > 0,
              reason: CLIENT_ENV.CASINO_ENABLED && casinoLandsInScan > 0 ? `${casinoLandsInScan} casino land(s) found in the scan.` : 'No built casino was found in the scanned lands, or casino is disabled.',
              suggestedPanel: 'Casino/Blackjack',
            },
            s3_send_quest: { ready: hasLand, reason: hasLand ? 'You own land for quest slots.' : 'Quest tasks require an owned land.', suggestedPanel: 'Land Quests' },
            s4_buy10_elements: { ready: hasPlant && hasSeed, reason: hasPlant && hasSeed ? 'You have plants and SEED for plant shop elements.' : 'Buying elements requires a plant and SEED.', suggestedPanel: 'Plant Shop' },
            s4_buy_shield: { ready: hasPlant && hasSeed, reason: hasPlant && hasSeed ? 'You have plants and SEED for a shield/fence purchase.' : 'Buying a shield/fence requires a plant and SEED.', suggestedPanel: 'Plant Shop/Fence' },
            s4_collect_star: { ready: hasPlant, reason: hasPlant ? 'Use Ranking/Attack to find eligible star opportunities.' : 'Collecting a star requires an attack-capable plant.', suggestedPanel: 'Ranking/Attack' },
            s4_play_arcade: { ready: hasPlant, reason: hasPlant ? 'Arcade games are available from plant actions.' : 'Arcade tasks require a plant.', suggestedPanel: 'Arcade' },
          };
          const incompleteWithReadiness = taskRows.incomplete.map((task) => ({
            ...task,
            ...(readiness[task.id] || { ready: false, reason: 'No readiness data available.', suggestedPanel: task.where }),
          }));

          return {
            address: target,
            mission,
            missionScore,
            readinessContext: {
              casinoLandsInScan,
              claimableStakeLeaf: formatToken(claimableStakeLeaf),
              landCount: lands.length,
              plantCount: plants.length,
              scannedProductionLandCount: productionScanLands.length,
              seedBalance: formatToken(seedBalance),
              warehouseLifetimeHours,
              warehousePts,
            },
            suggestedNext: incompleteWithReadiness
              .sort((a, b) => Number(b.ready) - Number(a.ready))
              .slice(0, suggestionLimit),
            taskCounts: {
              completed: taskRows.completed.length,
              incomplete: taskRows.incomplete.length,
              total: taskRows.rows.length,
            },
            tasks: taskRows.rows,
            streak,
            truncated: lands.length > productionScanLands.length,
          };
        },
        readClient,
      ),
    }),

    get_known_allowances: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read current ERC-20 allowances for known Pixotchi tokens and known Pixotchi spenders only. Use for approval troubleshooting, "why can’t I stake/swap/place order", or checking stale approvals. Never builds revoke/approve calldata.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        includeZeroAllowances: z.boolean().default(false),
      }),
      execute: async ({ address, includeZeroAllowances }) => withToolResult(
        'get_known_allowances',
        `Base ERC-20 allowance reads for known Pixotchi tokens and spenders via ${aiRpcSource}`,
        {
          confidence: 'medium',
          includeBlock: true,
          limitations: [
            'Known tokens/spenders only; arbitrary user-supplied contracts are intentionally unsupported.',
            'Allowance can change at any time. The UI must refresh before any approve/revoke action.',
            'Neural Seed never builds approval or revoke transactions.',
          ],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const bridgeConfig = getBridgeConfig();
          const tokenList = [
            { address: PIXOTCHI_TOKEN_ADDRESS, decimals: 18, id: 'seed', symbol: 'SEED' },
            { address: LEAF_CONTRACT_ADDRESS, decimals: 18, id: 'leaf', symbol: 'LEAF' },
            { address: CREATOR_TOKEN_ADDRESS, decimals: 18, id: 'pixotchi', symbol: 'PIXOTCHI' },
            { address: JESSE_TOKEN_ADDRESS, decimals: 18, id: 'jesse', symbol: 'JESSE' },
            { address: USDC_ADDRESS, decimals: 6, id: 'usdc', symbol: 'USDC' },
            { address: WETH_ADDRESS, decimals: 18, id: 'weth', symbol: 'WETH' },
            { address: getAddress(bridgeConfig.base.wrappedSOL), decimals: 9, id: 'wsol', symbol: 'wSOL' },
          ];
          const spenderList = [
            { address: PIXOTCHI_NFT_ADDRESS, id: 'plants_contract', label: 'Plant contract', useCases: ['plant mint', 'shop items', 'garden items', 'fence/shield', 'revive'] },
            { address: LAND_CONTRACT_ADDRESS, id: 'land_contract', label: 'Land contract', useCases: ['land mint', 'buildings', 'warehouse', 'marketplace', 'barracks', 'casino'] },
            { address: STAKE_CONTRACT_ADDRESS, id: 'staking_contract', label: 'Staking contract', useCases: ['stake SEED'] },
            { address: UNISWAP_ROUTER_ADDRESS, id: 'baseswap_router', label: 'BaseSwap router', useCases: ['swap'] },
            ...(BATCH_ROUTER_ADDRESS && isAddress(BATCH_ROUTER_ADDRESS)
              ? [{ address: BATCH_ROUTER_ADDRESS, id: 'batch_router', label: 'Batch transfer router', useCases: ['bulk NFT transfers'] }]
              : []),
          ];
          const reads = await Promise.allSettled(tokenList.flatMap((token) => spenderList.map(async (spender) => {
            const raw = token.id === 'seed' && spender.id === 'staking_contract'
              ? await getStakeAllowance(target)
              : await readErc20Allowance(readClient, token.address as `0x${string}`, target, spender.address as `0x${string}`);
            return {
              allowanceDisplay: `${compactTokenAmount(formatToken(raw, token.decimals))} ${token.symbol}`,
              allowanceRaw: raw.toString(),
              spender: spender.label,
              spenderAddress: spender.address,
              spenderId: spender.id,
              token: token.symbol,
              tokenAddress: token.address,
              tokenId: token.id,
              useCases: spender.useCases,
            };
          })));
          const allowances = reads
            .filter((result): result is PromiseFulfilledResult<UntypedValue> => result.status === 'fulfilled')
            .map((result) => result.value)
            .filter((entry) => includeZeroAllowances || BigInt(entry.allowanceRaw || '0') > BigInt(0));
          const errors = reads
            .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
            .map((result) => errorMessage(result.reason));

          return {
            address: target,
            allowances,
            errors: errors.slice(0, 5),
            includeZeroAllowances,
            knownOnly: true,
            spenderCount: spenderList.length,
            tokenCount: tokenList.length,
          };
        },
        readClient,
      ),
    }),

    get_bridge_status: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read public Solana bridge/Twin status: enabled config, predicted Twin address, Twin deployment, wSOL/SEED balances, and adapter setup. Use for Solana bridge onboarding or "is my twin ready" questions. Never builds bridge transactions or uses debug endpoints.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        includeTwinBalances: z.boolean().default(true),
        solanaAddress: SOLANA_ADDRESS_INPUT,
      }),
      execute: async ({ address, includeTwinBalances, solanaAddress }) => withToolResult(
        'get_bridge_status',
        `Public Solana bridge config and Base Twin reads via ${aiRpcSource}`,
        {
          confidence: 'medium',
          includeBlock: true,
          limitations: [
            'Bridge status is read-only. The AI cannot prepare bridge transactions, retry relays, sign Solana messages, or call bridge debug/admin endpoints.',
            'Solana wallet details are only checked when the authenticated session or prompt provides a Solana public address.',
          ],
        },
        async () => {
          const baseTarget = address ? getTargetAddress(address, context.userAddress) : getTargetAddress(undefined, context.userAddress);
          const sourceSolana = solanaAddress || context.sourceAddress || null;
          const bridgeConfig = getBridgeConfig();
          const pixotchiConfig = getPixotchiSolanaConfig();
          const validation = validateSolanaConfig();
          let twin: UntypedValue = null;

          if (sourceSolana && SOLANA_ADDRESS_INPUT.safeParse(sourceSolana).success) {
            const info = await getTwinAddressInfo(sourceSolana);
            const setup = await isTwinSetup(info.twinAddress, pixotchiConfig.twinAdapter);
            twin = {
              baseExplorerUrl: `https://basescan.org/address/${info.twinAddress}`,
              isDeployed: info.isDeployed,
              isSetup: setup,
              seedBalance: includeTwinBalances ? `${formatToken(info.seedBalance)} SEED` : undefined,
              solanaAddress: sourceSolana,
              solanaExplorerUrl: `${bridgeConfig.solana.blockExplorer}/address/${sourceSolana}`,
              twinAddress: info.twinAddress,
              wsolBalance: includeTwinBalances ? `${formatUnits(info.wsolBalance, 9)} wSOL` : undefined,
            };
          }

          return {
            baseAddress: baseTarget,
            bridge: {
              baseBridge: bridgeConfig.base.bridge,
              baseChainId: bridgeConfig.base.chainId,
              baseWrappedSOL: bridgeConfig.base.wrappedSOL,
              enabled: isSolanaEnabled(),
              estimatedBridgeTimeMs: 30000,
              missingPublicConfig: validation.missing,
              solanaBridgeProgram: bridgeConfig.solana.bridgeProgram,
              solanaExplorer: bridgeConfig.solana.blockExplorer,
              twinAdapter: pixotchiConfig.twinAdapter || null,
              validPublicConfig: validation.valid,
            },
            twin,
            ui: {
              setupWhere: 'Use the visible Solana bridge/setup controls in Mint, plant item actions, or bridge-enabled transaction buttons.',
              txStatusWhere: 'For a Base transaction hash, ask Neural Seed to run transaction status; for a Solana signature, use the Solana explorer link shown by the UI.',
            },
          };
        },
        readClient,
      ),
    }),

    get_missions: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read the authenticated user mission day, mission score, and streak data from gamification storage.',
      inputSchema: z.object({}),
      execute: async () => withToolResult(
        'get_missions',
        'Redis gamification storage',
        { cache: 'Current Redis state', includeBlock: false },
        async () => ({
          mission: await getMissionDay(context.userAddress),
          missionScore: await getMissionScore(context.userAddress),
          streak: await getStreak(context.userAddress),
        }),
        readClient,
      ),
    }),

    get_player_overview: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read the authenticated user wallet overview: plants, lands, balances, urgent plant care, and high-level totals. Use this first for broad personalized questions.',
      inputSchema: z.object({}),
      execute: async () => withToolResult(
        'get_player_overview',
        `Base contract reads for owned Pixotchi plants, lands, and token balances via ${aiRpcSource}`,
        { includeBlock: true },
        async () => {
          const target = getTargetAddress(undefined, context.userAddress);
          const [plants, lands, seedBalance, leafBalance, pixotchiBalance] = await Promise.all([
            readPlantsForAddress(target, readClient),
            getLandsByOwner(target, readClient),
            getTokenBalance(target, readClient),
            getLeafBalance(target, readClient),
            getTokenBalanceForToken(target, CREATOR_TOKEN_ADDRESS, readClient),
          ]);
          const normalizedPlants = plants.map(normalizePlant);
          const urgentPlants = normalizedPlants.filter((plant) =>
            plant.status >= 2 || plant.timeUntilStarvingHours < 10
          );

          return {
            address: target,
            balances: {
              leaf: formatToken(leafBalance),
              pixotchi: formatToken(pixotchiBalance),
              seed: formatToken(seedBalance),
            },
            landSummary: {
              totalLands: lands.length,
              totalStoredLifetimeSeconds: lands.reduce((sum, land) => sum + toNumber(land.accumulatedPlantLifetime), 0),
              totalStoredLifetimeHours: lands.reduce((sum, land) => sum + toNumber(land.accumulatedPlantLifetime), 0) / 3600,
              totalStoredPts: lands.reduce((sum, land) => sum + toNumber(land.accumulatedPlantPoints, 12), 0),
            },
            plantSummary: {
              ...summarizePlants(normalizedPlants),
            },
            urgentPlants: urgentPlants.slice(0, 10),
          };
        },
        readClient,
      ),
    }),

    get_plant_care_audit: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Audit plant care for a wallet: urgent dry/dying/dead/low-TOD plants, fence status, live care prices, wallet balances, revive price, and land warehouse resources. Use for plant care, "what needs attention", "can I save my plants", or large-wallet plant triage.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        includePrices: z.boolean().default(true),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ address, includePrices, limit }) => withToolResult(
        'get_plant_care_audit',
        `Base contract reads for Pixotchi plants, care prices, balances, and land warehouse resources via ${aiRpcSource}`,
        {
          confidence: 'medium',
          includeBlock: true,
          limitations: [
            `Audits at most ${AI_PLANT_CARE_AUDIT_MAX_PLANTS} plants per request for large wallets.`,
            'Care prices, balances, and plant timers can change; refresh Farm before signing any item, fence, revive, or resource transaction.',
            'Neural Seed cannot purchase items, revive plants, or apply resources.',
          ],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const [plants, lands, seedBalance, leafBalance, reviveResult, shopItemsResult, gardenItemsResult, fenceQuoteResult] = await Promise.allSettled([
            readPlantsForAddress(target, readClient),
            getLandsByOwner(target, readClient),
            getTokenBalance(target, readClient),
            getLeafBalance(target, readClient),
            includePrices ? getRevivePrice(readClient) : Promise.resolve(BigInt(0)),
            includePrices ? getShopItems(readClient) : Promise.resolve([]),
            includePrices ? getAllGardenItems(readClient) : Promise.resolve([]),
            includePrices ? quoteFenceV2(1, readClient) : Promise.resolve(BigInt(0)),
          ]);
          const normalizedPlants = plants.status === 'fulfilled'
            ? plants.value.slice(0, AI_PLANT_CARE_AUDIT_MAX_PLANTS).map(normalizePlant)
            : [];
          const urgency = normalizedPlants.map((plant) => {
            const reasons = [
              plant.status === 4 ? 'dead' : null,
              plant.status === 3 ? 'dying' : null,
              plant.status === 2 ? 'dry' : null,
              plant.timeUntilStarvingHours > 0 && plant.timeUntilStarvingHours < 10 ? 'under_10h_tod' : null,
              !plant.fence.active ? 'no_active_fence' : null,
              plant.fence.active && plant.fence.daysRemaining < 1 ? 'fence_expires_under_1d' : null,
            ].filter(Boolean);
            const priority = (plant.status === 4 ? 100 : 0) +
              (plant.status === 3 ? 80 : 0) +
              (plant.status === 2 ? 60 : 0) +
              (plant.timeUntilStarvingHours > 0 && plant.timeUntilStarvingHours < 10 ? 40 : 0) +
              (!plant.fence.active ? 10 : 0);

            return {
              ...plant,
              careReasons: reasons,
              carePriority: priority,
            };
          });
          const urgentPlants = urgency
            .filter((plant) => plant.careReasons.length > 0)
            .sort((a, b) => b.carePriority - a.carePriority || a.timeUntilStarvingHours - b.timeUntilStarvingHours);
          const revivePrice = reviveResult.status === 'fulfilled'
            ? formatPriceFields(reviveResult.value, PIXOTCHI_TOKEN_ADDRESS)
            : null;
          const shopItems = shopItemsResult.status === 'fulfilled'
            ? shopItemsResult.value.map((item) => ({
              effectTimeSeconds: item.effectTime,
              id: item.id,
              name: item.name,
              ...formatPriceFields(item.price, PIXOTCHI_TOKEN_ADDRESS),
            }))
            : [];
          const gardenItems = gardenItemsResult.status === 'fulfilled'
            ? gardenItemsResult.value.map((item) => ({
              id: item.id,
              name: item.name,
              points: item.points,
              timeExtensionSeconds: item.timeExtension,
              ...formatPriceFields(item.price, PIXOTCHI_TOKEN_ADDRESS),
            }))
            : [];
          const fenceQuote = fenceQuoteResult.status === 'fulfilled'
            ? formatPriceFields(fenceQuoteResult.value, PIXOTCHI_TOKEN_ADDRESS)
            : null;
          const auditedLands = lands.status === 'fulfilled' ? lands.value : [];
          const seed = seedBalance.status === 'fulfilled' ? seedBalance.value : BigInt(0);

          return {
            address: target,
            balances: {
              leaf: leafBalance.status === 'fulfilled' ? `${formatToken(leafBalance.value)} LEAF` : null,
              seed: `${formatToken(seed)} SEED`,
            },
            careOptions: includePrices
              ? {
                fenceOneDay: fenceQuote?.priceDisplay ?? null,
                gardenItems: gardenItems.slice(0, 12),
                revivePrice: revivePrice?.priceDisplay ?? null,
                shopItems: shopItems.slice(0, 12),
              }
              : null,
            errors: [
              plants.status === 'rejected' ? `plants: ${errorMessage(plants.reason)}` : null,
              lands.status === 'rejected' ? `lands: ${errorMessage(lands.reason)}` : null,
              seedBalance.status === 'rejected' ? `seedBalance: ${errorMessage(seedBalance.reason)}` : null,
              leafBalance.status === 'rejected' ? `leafBalance: ${errorMessage(leafBalance.reason)}` : null,
              reviveResult.status === 'rejected' ? `revivePrice: ${errorMessage(reviveResult.reason)}` : null,
              shopItemsResult.status === 'rejected' ? `shopItems: ${errorMessage(shopItemsResult.reason)}` : null,
              gardenItemsResult.status === 'rejected' ? `gardenItems: ${errorMessage(gardenItemsResult.reason)}` : null,
              fenceQuoteResult.status === 'rejected' ? `fenceQuote: ${errorMessage(fenceQuoteResult.reason)}` : null,
            ].filter(Boolean),
            plantSummary: summarizePlants(normalizedPlants),
            recommendedCare: urgentPlants.slice(0, limit).map((plant) => ({
              careReasons: plant.careReasons,
              fence: plant.fence,
              id: plant.id,
              level: plant.level,
              name: plant.name,
              statusLabel: plant.statusLabel,
              timeUntilStarvingHours: plant.timeUntilStarvingHours,
              uiNextStep: plant.status === 4
                ? 'Open the plant in Farm and use the visible Revive flow if available.'
                : 'Open the plant in Farm and use visible care, garden, item, or fence controls as needed.',
            })),
            truncated: (plants.status === 'fulfilled' && plants.value.length > normalizedPlants.length) || urgentPlants.length > limit,
            urgentCareCount: urgentPlants.length,
            urgentPlants: urgentPlants.slice(0, limit),
            warehouseTotals: {
              landCount: auditedLands.length,
              storedLifetimeHours: auditedLands.reduce((sum, land) => sum + toNumber(land.accumulatedPlantLifetime), 0) / 3600,
              storedPts: auditedLands.reduce((sum, land) => sum + toNumber(land.accumulatedPlantPoints, 12), 0),
            },
          };
        },
        readClient,
      ),
    }),

    get_arcade_status: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read Arcade readiness for owned or selected plants: stars, Box game cooldowns, SpinLeaf cooldowns, star cost, and current reward table. Use for arcade, stars, spin, box game, or "which plants can play". Read-only.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        limit: z.number().int().min(1).max(30).default(10),
        plantIds: z.array(z.number().int().min(0)).max(30).optional(),
      }),
      execute: async ({ address, limit, plantIds }) => withToolResult(
        'get_arcade_status',
        `Base contract reads for Pixotchi Arcade Box and SpinLeaf cooldowns via ${aiRpcSource}`,
        {
          confidence: 'medium',
          includeBlock: true,
          limitations: [
            `Scans at most ${AI_ARCADE_STATUS_MAX_PLANTS} plants per request unless specific plant IDs are supplied.`,
            'Spin pending commit/reveal state may also depend on local browser state; the Arcade dialog is the final source for action buttons.',
            'Neural Seed cannot play arcade games, spend stars, reveal spins, or claim rewards.',
          ],
        },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const rawPlants = plantIds?.length
            ? await getPlantsInfoExtended(plantIds, readClient)
            : await readPlantsForAddress(target, readClient);
          const normalizedPlants = rawPlants
            .slice(0, plantIds?.length ? rawPlants.length : Math.min(rawPlants.length, AI_ARCADE_STATUS_MAX_PLANTS))
            .map(normalizePlant);
          const [globalCooldown, starCost, rewards] = await Promise.all([
            readClient.readContract({
              address: PIXOTCHI_NFT_ADDRESS,
              abi: SPIN_GAME_ABI,
              functionName: 'getCoolDownTime',
              args: [],
            }) as Promise<bigint>,
            readClient.readContract({
              address: PIXOTCHI_NFT_ADDRESS,
              abi: SPIN_GAME_ABI,
              functionName: 'getStarCost',
              args: [],
            }) as Promise<bigint>,
            Promise.all(Array.from({ length: 6 }, (_, index) =>
              readClient.readContract({
                address: PIXOTCHI_NFT_ADDRESS,
                abi: SPIN_GAME_ABI,
                functionName: 'getReward',
                args: [BigInt(index)],
              }) as Promise<[bigint, bigint, bigint]>
            )),
          ]);
          const rewardTable = rewards.map(([pointsDelta, timeExtension, leafAmount], index) => ({
            index,
            leafDisplay: `${formatToken(leafAmount)} LEAF`,
            pointsDelta: formatSignedPts(pointsDelta),
            timeExtensionHours: Number(timeExtension) / 3600,
            timeExtensionSeconds: timeExtension.toString(),
          }));
          const sharedSpin = {
            globalCooldownSeconds: Number(globalCooldown),
            starCost: Number(starCost),
          };
          const plants = await Promise.all(normalizedPlants.slice(0, limit).map((plant) => readArcadeStatusForPlant(readClient, plant, sharedSpin)));

          return {
            address: plantIds?.length ? undefined : target,
            count: plants.length,
            plants,
            rewardTable,
            summary: {
              boxReadyPlants: plants.filter((plant) => plant.box.normal.ready || plant.box.withStar.ready).length,
              spinReadyPlants: plants.filter((plant) => plant.spin.ready).length,
              totalStars: normalizedPlants.reduce((sum, plant) => sum + plant.stars, 0),
            },
            totalOwned: plantIds?.length ? undefined : rawPlants.length,
            truncated: rawPlants.length > normalizedPlants.length || normalizedPlants.length > plants.length,
          };
        },
        readClient,
      ),
    }),

    get_plants: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read Pixotchi plant NFTs by authenticated wallet, public wallet address, or specific plant IDs. Includes status, PTS, rewards, stars, TOD, fences, and active items.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
        limit: z.number().int().min(1).max(50).default(20),
        plantIds: z.array(z.number().int().min(0)).max(50).optional(),
      }),
      execute: async ({ address, limit, plantIds }) => withToolResult(
        'get_plants',
        `Base contract reads for Pixotchi NFT plant state via ${aiRpcSource}`,
        { includeBlock: true },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const plants = plantIds?.length
            ? await getPlantsInfoExtended(plantIds, readClient)
            : await readPlantsForAddress(target, readClient);
          const normalized = plants
            .slice(0, limit)
            .map(normalizePlant);
          const allNormalized = plants.map(normalizePlant);

          return {
            address: plantIds?.length ? undefined : target,
            count: normalized.length,
            plants: normalized,
            summary: summarizePlants(allNormalized),
            totalOwned: plantIds?.length ? undefined : plants.length,
            truncated: plants.length > normalized.length,
          };
        },
        readClient,
      ),
    }),

    get_staking: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read authenticated or public wallet staking status: staked SEED, claimable rewards, total staked, reward ratio, time unit, and current allowance state. Read-only.',
      inputSchema: z.object({
        address: ADDRESS_INPUT,
      }),
      execute: async ({ address }) => withToolResult(
        'get_staking',
        `Base contract reads for Pixotchi staking contract via ${aiRpcSource}`,
        { includeBlock: true },
        async () => {
          const target = getTargetAddress(address, context.userAddress);
          const composite = await getStakeComposite(target, readClient);
          const claimableLeaf = composite.stake ? formatToken(composite.stake.rewards) : '0';
          return {
            address: target,
            approved: composite.approved,
            claimableLeaf,
            claimableRewards: {
              amount: claimableLeaf,
              token: 'LEAF',
            },
            rewardRatio: composite.rewardRatio
              ? {
                denominator: composite.rewardRatio.denominator.toString(),
                numerator: composite.rewardRatio.numerator.toString(),
              }
              : null,
            stakedSeed: composite.stake ? formatToken(composite.stake.staked) : '0',
            timeUnitSeconds: composite.timeUnit?.toString() ?? null,
            totalStakedSeed: composite.totalStaked ? formatToken(composite.totalStaked) : null,
          };
        },
        readClient,
      ),
    }),

    get_swap_quote: tool({
      ...READ_TOOL_DEFAULTS,
      description: 'Read an informational Pixotchi swap quote only. This never prepares or executes a swap and must not be presented as financial advice.',
      inputSchema: z.object({
        amount: z.string().trim().regex(/^\d+(\.\d+)?$/).describe('Human-readable amount in the sell token decimals.'),
        buyToken: USER_SWAP_TOKEN_ENUM,
        sellToken: USER_SWAP_TOKEN_ENUM,
      }),
      execute: async ({ amount, buyToken, sellToken }) => withToolResult(
        'get_swap_quote',
        `Kyber/Base swap quote service and read-only routing helpers via ${aiRpcSource}`,
        { cache: 'Quote is time-sensitive; the swap UI must fetch a fresh quote before any action.', includeBlock: true },
        async () => {
          if (!isUserSwapTokenId(sellToken) || !isUserSwapTokenId(buyToken)) {
            throw new Error('Unsupported token.');
          }
          const sell = getSwapToken(sellToken as UserSwapTokenId);
          const buy = getSwapToken(buyToken as UserSwapTokenId);
          const quote = await getSwapQuoteForUserPair({
            amountIn: parseUnits(amount, sell.decimals),
            buyToken: buyToken as UserSwapTokenId,
            originAddress: getTargetAddress(undefined, context.userAddress),
            sellToken: sellToken as UserSwapTokenId,
          });
          return {
            amountIn: amount,
            blockedReason: quote.blockedReason,
            buyToken: buy.displaySymbol,
            expectedOut: formatUnits(BigInt(quote.expectedOut || '0'), buy.decimals),
            informationalOnly: true,
            marketSlippageBps: quote.marketSlippageBps,
            minOut: formatUnits(BigInt(quote.minOut || '0'), buy.decimals),
            noFinancialAdvice: true,
            route: quote.steps.map((step) => ({
              kind: step.kind,
              routeLabel: step.routeLabel,
              routeSources: step.routeSources,
              warnings: step.warnings,
            })),
            sellToken: sell.displaySymbol,
            strategy: quote.strategy,
            taxBps: quote.taxBps,
            warnings: quote.warnings,
          };
        },
        readClient,
      ),
    }),
  } as const;
}
