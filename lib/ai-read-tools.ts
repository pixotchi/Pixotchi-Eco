import 'server-only';

import { tool } from 'ai';
import { decodeEventLog, formatUnits, getAddress, isAddress, parseAbiItem, parseUnits, type Hex } from 'viem';
import { z } from 'zod';
import {
  barracksGetLandStateV2,
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
  getQuestSlotsByLandId,
  getRevivePrice,
  getShopItems,
  getStakeComposite,
  getStrainInfo,
  getTokenBalance,
  getTokenBalanceForToken,
  JESSE_TOKEN_ADDRESS,
  LAND_CONTRACT_ADDRESS,
  LEAF_CONTRACT_ADDRESS,
  PIXOTCHI_NFT_ADDRESS,
  PIXOTCHI_TOKEN_ADDRESS,
  quoteFenceV2,
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
import { PLANT_STRAINS_BY_ID, TOWN_BUILDING_NAMES, VILLAGE_BUILDING_NAMES } from './constants';
import { getFenceStatus } from './utils';
import type { PixotchiReadClient } from './contracts';
import type { ActivityEvent, BarracksLandStateV2, BuildingData, Land, NormalizedOnchainActivity, Plant } from './types';

type ReadOnlyToolContext = {
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

const ADDRESS_INPUT = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .optional()
  .describe('Optional public wallet address. Omit this to use the authenticated user.');

const USER_SWAP_TOKEN_ENUM = z.enum(USER_SWAP_TOKEN_IDS);
const GAME_ACTION_TOPIC_ENUM = z.enum(GAME_ACTION_TOPICS);

const TOWN_BUILDING_LABELS: Record<number, string> = {
  ...TOWN_BUILDING_NAMES,
  6: 'Casino',
  8: 'Barracks',
};

const MAX_BUILDING_AGGREGATE_LANDS = 100;
const AI_WALLET_ACTIVITY_BLOCK_RANGE = Number.parseInt(process.env.AI_WALLET_ACTIVITY_BLOCK_RANGE || '', 10) || 150_000;
const AI_WALLET_ACTIVITY_LOG_LIMIT = Number.parseInt(process.env.AI_WALLET_ACTIVITY_LOG_LIMIT || '', 10) || 60;
const AI_WALLET_ACTIVITY_LOG_CHUNK_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.AI_WALLET_ACTIVITY_LOG_CHUNK_CONCURRENCY || '', 10) || 4,
);
const ERC20_TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const ERC721_TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
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
  [WETH_ADDRESS.toLowerCase()]: 'WETH',
  [USDC_ADDRESS.toLowerCase()]: 'USDC',
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

    get_wallet_token_balances: tool({
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
              healthyPlants: normalizedPlants.filter((plant) => plant.status <= 1).length,
              totalPlants: normalizedPlants.length,
              totalRewardsEth: normalizedPlants.reduce((sum, plant) => sum + plant.rewardsEth, 0),
              totalStars: normalizedPlants.reduce((sum, plant) => sum + plant.stars, 0),
              totalPts: normalizedPlants.reduce((sum, plant) => sum + plant.scorePts, 0),
              urgentCareCount: urgentPlants.length,
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

    get_transaction_status: tool({
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

    get_lands: tool({
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

    get_leaderboards: tool({
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

    get_missions: tool({
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
              healthyPlants: normalizedPlants.filter((plant) => plant.status <= 1).length,
              totalPlants: normalizedPlants.length,
              totalRewardsEth: normalizedPlants.reduce((sum, plant) => sum + plant.rewardsEth, 0),
              totalStars: normalizedPlants.reduce((sum, plant) => sum + plant.stars, 0),
              totalPts: normalizedPlants.reduce((sum, plant) => sum + plant.scorePts, 0),
              urgentCareCount: urgentPlants.length,
            },
            urgentPlants: urgentPlants.slice(0, 10),
          };
        },
        readClient,
      ),
    }),

    get_plants: tool({
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

          return {
            address: plantIds?.length ? undefined : target,
            count: normalized.length,
            plants: normalized,
            totalOwned: plantIds?.length ? undefined : plants.length,
            truncated: plants.length > normalized.length,
          };
        },
        readClient,
      ),
    }),

    get_staking: tool({
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
