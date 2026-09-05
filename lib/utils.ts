import { formatTokenDisplay, formatTokenDisplayCompact } from './token-display';
import { formatDurationSeconds } from './duration-display';
import { type ClassValue,clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { ADDRESS_REGEX,CREATOR_TOKEN_ADDRESS,CRYPTICPOET_TOKEN_ADDRESS,JESSE_TOKEN_ADDRESS,LEAF_CONTRACT_ADDRESS,PIXOTCHI_TOKEN_ADDRESS } from "./contracts";
import { type Plant } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Address validation helper
export function isValidEthereumAddressFormat(address: string): boolean {
  return ADDRESS_REGEX.test(address);
}

// Plant image level calculation (from main app)
const LEVELS_PER_IMAGE: number = 10;
const MAX_IMAGE_LEVEL: number = 22;

export function calculateImageLevel(level: number): number {
  if (level === 0) return 0; // Handle potential edge case
  const imageLevel = Math.floor((level - 1) / LEVELS_PER_IMAGE);
  return Math.min(imageLevel, MAX_IMAGE_LEVEL);
}

// Format score into points. The base unit for score is 1e12.
export function formatScore(score: number): string {
  const points = score / 1e12;
  return points.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

// Format wei amount to ETH string
export function formatEth(wei: number | bigint): string {
  const ether = Number(wei) / 1e18;
  return ether.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
}

// Format score into shortened format for leaderboard (e.g., 1.33M, 810.4K)
export function formatScoreShort(score: number): string {
  const points = score / 1e12;

  if (points >= 1000000) {
    return (points / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  } else if (points >= 1000) {
    return (points / 1000).toFixed(1).replace(/\.?0+$/, '') + 'K';
  } else {
    return points.toFixed(2).replace(/\.?0+$/, '');
  }
}

// Format ETH with max 6 decimals for leaderboard
export function formatEthShort(wei: number | bigint): string {
  const ether = Number(wei) / 1e18;
  if (!Number.isFinite(ether) || ether === 0) return '0';
  if (ether > 0 && ether < 0.000001) return '<0.000001';

  const maximumFractionDigits = ether < 0.01 ? 6 : ether < 1 ? 5 : 4;
  return ether.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits,
  });
}

// Format duration from seconds to a readable string (e.g., "2d 4h", "30m")
export const BASE_SECONDS_PER_BLOCK = 2;

export function formatUpgradeDuration(blocks: bigint): string {
  return blocks === BigInt(0) ? 'Instant' : `~${formatDuration(Number(blocks) * BASE_SECONDS_PER_BLOCK)}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  return formatDurationSeconds(BigInt(Math.floor(seconds)));
}


// Format numbers with commas
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Format token amount with precision-safe BigInt handling.
 * Uses a fixed comma-grouped display to avoid locale-dependent grouping quirks
 * (e.g., "5520" vs "99.309") and to avoid Number precision loss.
 */
export function formatTokenAmount(amount: bigint, decimals: number = 18): string {
  return formatTokenDisplay(amount, decimals, 2);
}

/**
 * Precision-safe token amount formatting that preserves accuracy for very large values.
 * Uses string-based arithmetic to avoid JavaScript Number precision limits (2^53).
 * 
 * @param amount - The raw BigInt amount
 * @param decimals - Token decimals (default: 18)
 * @param maxDisplayDecimals - Maximum decimals to display (default: 4)
 * @returns Formatted string with locale-aware thousand separators
 */
export function formatTokenAmountPrecise(amount: bigint, decimals = 18, maxDisplayDecimals = 4): string {
  return formatTokenDisplay(amount, decimals, maxDisplayDecimals);
}

export function getCasinoTokenImage(tokenAddress: string | null | undefined): string {
  if (!tokenAddress) return '/PixotchiKit/COIN.svg';

  const normalized = tokenAddress.toLowerCase();
  if (normalized === PIXOTCHI_TOKEN_ADDRESS.toLowerCase()) return '/PixotchiKit/COIN.svg';
  if (normalized === LEAF_CONTRACT_ADDRESS.toLowerCase()) return '/icons/leaf.png';
  if (normalized === CREATOR_TOKEN_ADDRESS.toLowerCase()) return '/icons/cc.png';
  if (normalized === CRYPTICPOET_TOKEN_ADDRESS.toLowerCase()) return '/icons/poet.png';
  if (normalized === JESSE_TOKEN_ADDRESS.toLowerCase()) return '/icons/jessetoken.png';
  return '/PixotchiKit/COIN.svg';
}

/**
 * Format token amount for display with compact notation (K, M, B, T).
 * Uses precision-safe BigInt handling for accurate threshold comparisons.
 */
export function formatTokenAmountCompact(amount: bigint, decimals: number = 18): string {
  return formatTokenDisplayCompact(amount, decimals);
}

// Standardized address formatting. Defined in ./format-address (a leaf module that
// imports no contract data) and re-exported here so every existing
// `from "@/lib/utils"` import keeps working, while lib/contracts.ts can import it
// without creating a contracts <-> utils cycle.
export { formatAddress } from "./format-address";


export function getPlantStatusText(status: number): string {
  switch (status) {
    case 0: return 'Great';
    case 1: return 'Okay';
    case 2: return 'Dry';
    case 3: return 'Dying';
    case 4: return 'Dead';
    default: return 'Unknown';
  }
}

export function getStrainName(strainId: number): string {
  switch (strainId) {
    case 0: return 'OG';
    case 1: return 'Flora';
    case 2: return 'Taki';
    case 3: return 'Rosa';
    case 4: return 'Zest';
    case 5: return 'TYJ (Thank you, Jesse)';
    default: return `Strain ${strainId}`;
  }
}

export function getFriendlyErrorMessage(error: UntypedValue): string {
  if (error && typeof error.message === 'string') {
    const message = error.message.toLowerCase();
    if (
      message.includes('user rejected') ||
      message.includes('request rejected') ||
      message.includes('user denied')
    ) {
      return 'You rejected the transaction in your wallet.';
    }
    if (message.includes('insufficient funds')) {
      return 'You have insufficient funds to complete this transaction.';
    }
    if (message.includes('execution reverted')) {
      return 'The transaction failed. Please try again.';
    }
    if (message.includes('timeout') || message.includes('timed out')) {
      return 'The network took too long to respond. Please try again.';
    }
    if (message.includes('no wallet') || message.includes('wallet not connected')) {
      return 'Your wallet is not available. Reconnect it and try again.';
    }
  }
  return 'An unexpected error occurred. Please try again later.';
}


// Static building data for caching
const TOWN_BUILDINGS: { [key: number]: string } = {
  1: "Stake House",
  3: "Warehouse",
  5: "Marketplace",
  6: "Casino",
  7: "Farmer House",
  8: "Barracks",
};

const VILLAGE_BUILDINGS: { [key: number]: string } = {
  0: "Solar Panels",
  3: "Soil Factory",
  5: "Bee Farm"
};

const BUILDING_ICON_MAP: { [key: string]: string } = {
  "Solar Panels": "/icons/solar-panels.png",
  "Soil Factory": "/icons/soil-factory.png",
  "Bee Farm": "/icons/bee-house.png",
  "Stake House": "/icons/stake-house.png",
  "Warehouse": "/icons/ware-house.png",
  "Marketplace": "/icons/marketplace.png",
  "Casino": "/icons/casino.png",
  "Farmer House": "/icons/farmer-house.png",
  "Barracks": "/icons/barracks.webp",
};

// Building name and icon caching
const buildingNameCache = new Map<string, string>();
const buildingIconCache = new Map<string, string>();

// Land-specific helper functions with caching
export function getBuildingName(buildingId: number, isTown: boolean = false): string {
  const cacheKey = `${buildingId}-${isTown}`;

  // Check cache first
  if (buildingNameCache.has(cacheKey)) {
    return buildingNameCache.get(cacheKey)!;
  }

  // Compute building name
  let buildingName: string;
  if (isTown) {
    buildingName = TOWN_BUILDINGS[buildingId] || `Building ${buildingId}`;
  } else {
    buildingName = VILLAGE_BUILDINGS[buildingId] || `Building ${buildingId}`;
  }

  // Cache the result
  buildingNameCache.set(cacheKey, buildingName);
  return buildingName;
}

export function getQuestDifficulty(difficulty: number): string {
  const difficulties: { [key: number]: string } = {
    0: "Easy",
    1: "Medium",
    2: "Hard"
  };
  return difficulties[difficulty] || `Level ${difficulty}`;
}

export function getQuestReward(rewardType: number): string {
  const rewards: { [key: number]: string } = {
    0: "SEED",
    1: "LEAF",
    2: "time extension",
    3: "PTS",
    4: "experience"
  };
  return rewards[rewardType] || "rewards";
}

export function formatQuestReward(rewardType: number, amount: string): string {
  const rewardName = getQuestReward(rewardType);

  // Convert wei to readable format for LEAF (type 1) and SEED (type 0)
  if (rewardType === 0 || rewardType === 1) {
    const value = parseFloat(amount) / 1e18; // Convert from wei
    return `${value.toFixed(2)} ${rewardName}`;
  }

  // For plant points (PTS), use same normalization as Plants tab
  if (rewardType === 3) {
    const ptsValue = parseFloat(amount);
    const formattedPts = formatScore(ptsValue);
    return `${formattedPts} ${rewardName}`;
  }

  // For experience, convert from wei
  if (rewardType === 4) {
    const value = parseFloat(amount) / 1e18;
    return `${value.toFixed(0)} ${rewardName}`;
  }

  // For time extension (type 2), convert seconds to hours and show as TOD
  if (rewardType === 2) {
    const seconds = parseFloat(amount);
    const hours = seconds / 3600; // Convert seconds to hours
    return `${hours.toFixed(1)}H TOD`;
  }

  // For other types, show raw amount
  return `${amount} ${rewardName}`;
}

// Format XP (experience points) from wei to readable format
export function formatXP(xp: number | string | bigint): string {
  const xpValue = typeof xp === 'string' ? parseFloat(xp) : Number(xp);
  const formattedXP = xpValue / 1e18; // Convert from wei
  return formattedXP.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// Building Management Utilities
export function calculateUpgradeProgress(building: UntypedValue, currentBlock: bigint): number {
  if (!building.isUpgrading) return 0;

  const totalBlocks = building.blockHeightUntilUpgradeDone - building.blockHeightUpgradeInitiated;
  if (totalBlocks <= BigInt(0)) {
    return currentBlock >= building.blockHeightUntilUpgradeDone ? 100 : 0;
  }
  const blocksLeft = building.blockHeightUntilUpgradeDone - currentBlock;
  const progress = 100 - (Number(blocksLeft) / Number(totalBlocks)) * 100;

  return Math.max(0, Math.min(100, progress));
}

export function calculateTimeLeft(building: { blockHeightUntilUpgradeDone: bigint }, currentBlock: bigint): string {
  const blocksLeft = building.blockHeightUntilUpgradeDone - currentBlock;
  if (blocksLeft <= BigInt(0)) return "Complete";
  const seconds = blocksLeft * BigInt(BASE_SECONDS_PER_BLOCK);
  const d = seconds / BigInt(86400);
  const h = seconds % BigInt(86400) / BigInt(3600);
  const m = seconds % BigInt(3600) / BigInt(60);

  if (d > BigInt(0)) {
    return `${d}d ${h}h ${m}m`;
  }
  if (h > BigInt(0)) {
    return `${h}h ${m}m`;
  } else {
    return m > BigInt(0) ? `${m}m` : '<1m';
  }
}


export function getBuildingIcon(buildingName: string): string {
  // Check cache first
  if (buildingIconCache.has(buildingName)) {
    return buildingIconCache.get(buildingName)!;
  }

  // Compute icon path
  const iconPath = BUILDING_ICON_MAP[buildingName] || "/icons/stake-house.png";

  // Cache the result
  buildingIconCache.set(buildingName, iconPath);
  return iconPath;
}

export function formatProductionRate(rate: bigint): string {
  return formatTokenDisplay(rate, 12);
}

export function formatLifetimeProduction(seconds: bigint): string {
  return formatDurationSeconds(seconds);
}

// Utility function for formatting large numbers with M/K suffixes (used in balance-card and user-stats-service)
export function formatLargeNumber(amount: bigint): string {
  // Delegates to the BigInt-safe compact formatter: the old inline version ran
  // Number(amount)/1e18, which loses precision above 2^53 — while the correct
  // implementation sat unused in this same file.
  return formatTokenAmountCompact(amount);
}


// ============ FENCE V1/V2 UTILITIES ============

/**
 * Check if timestamps are approximately equal (within 1 second tolerance for blockchain variance)
 */
export const approxTimestampEqual = (a: number, b: number): boolean => Math.abs(a - b) <= 1;

/**
 * Get comprehensive fence status including V1, V2, and mirroring state
 */
export const getFenceStatus = (plant: Plant): {
  hasActiveFence: boolean;
  fenceV1Active: boolean;
  fenceV2Active: boolean;
  isMirroringV1: boolean;
  expiresAt: number;
  daysRemaining: number;
  type: 'V1' | 'V2' | 'V1+V2' | null;
} => {
  const now = Math.floor(Date.now() / 1000);

  // Check V2 status
  const fenceV2State = plant.fenceV2 ?? null;
  const fenceV2EffectUntil = Number(fenceV2State?.activeUntil ?? 0);
  const fenceV2Active = Boolean(fenceV2State?.isActive && fenceV2EffectUntil > now);
  const fenceV2Mirroring = Boolean(fenceV2State?.isMirroringV1);

  // Check V1 status - but only if not mirrored by V2
  const fenceV1Active = plant.extensions?.some((extension: UntypedValue) => {
    const owned = extension?.shopItemOwned || [];
    return owned.some((item: UntypedValue) => {
      if (!item?.effectIsOngoingActive) return false;
      const lowerName = item?.name?.toLowerCase() || '';
      if (!lowerName.includes('fence') && !lowerName.includes('shield')) return false;
      const effectUntil = Number(item?.effectUntil || 0);
      if (!Number.isFinite(effectUntil) || effectUntil <= 0) return false;
      // Skip if mirroring V2
      if (fenceV2Active && fenceV2Mirroring && approxTimestampEqual(effectUntil, fenceV2EffectUntil)) {
        return false;
      }
      return effectUntil > now;
    });
  }) || false;

  // Determine expiry info (prefer V2 if both active)
  let expiresAt = 0;
  let daysRemaining = 0;
  let type: 'V1' | 'V2' | 'V1+V2' | null = null;

  if (fenceV2Active) {
    expiresAt = fenceV2EffectUntil;
    daysRemaining = fenceV2State?.totalDaysPurchased || Math.ceil((fenceV2EffectUntil - now) / (24 * 60 * 60));
    type = fenceV1Active ? 'V1+V2' : 'V2';
  } else if (fenceV1Active) {
    const v1Fence = plant.extensions
      ?.flatMap(ext => ext.shopItemOwned || [])
      .find(item => {
        const lowerName = item?.name?.toLowerCase() || '';
        return (lowerName.includes('fence') || lowerName.includes('shield')) &&
          item?.effectIsOngoingActive &&
          Number(item?.effectUntil || 0) > now;
      });
    if (v1Fence) {
      expiresAt = Number(v1Fence.effectUntil);
      daysRemaining = Math.ceil((expiresAt - now) / (24 * 60 * 60));
      type = 'V1';
    }
  }

  return {
    hasActiveFence: fenceV1Active || fenceV2Active,
    fenceV1Active,
    fenceV2Active,
    isMirroringV1: fenceV2Mirroring,
    expiresAt,
    daysRemaining,
    type
  };
};

/**
 * Get array of active fences for display (handles both V1 and V2, respects mirroring)
 */
export const getActiveFences = (plant: Plant): Array<{ type: 'Fence'; effectUntil: number }> => {
  const status = getFenceStatus(plant);
  if (status.hasActiveFence) {
    return [{ type: 'Fence', effectUntil: status.expiresAt }];
  }
  return [];
};
