import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatUnits } from "viem";
import { ADDRESS_REGEX } from "./contracts";
import { ADDRESS_TRUNCATION } from "./constants";

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
  return ether.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

// Format duration from seconds to a readable string (e.g., "2d 4h", "30m")
export function formatDuration(seconds: number): string {
  if (seconds === 0) return '0s';

  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  let result = '';
  if (d > 0) result += `${d}d `;
  if (h > 0) result += `${h}h `;
  if (m > 0 && d === 0) result += `${m}m `; // Show minutes only if no days
  if (s > 0 && h === 0 && d === 0) result += `${s}s`; // Show seconds only if no hours/days

  return result.trim() || '0s';
}

// Format time components
export function formatTime(seconds: number): [string, string, string, string] {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  return [
    days.toString().padStart(2, '0'),
    hours.toString().padStart(2, '0'), 
    minutes.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0')
  ];
}

// Format numbers with commas
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

export function formatTokenAmount(amount: bigint, decimals: number = 18): string {
  const formatted = formatUnits(amount, decimals);
  return parseFloat(formatted).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Standardized address formatting using centralized truncation constants
export function formatAddress(address: string, prefixLen?: number, suffixLen?: number, full: boolean = false): string {
  if (full || address.length <= 14) return address;
  const prefix = prefixLen ?? ADDRESS_TRUNCATION.prefix;
  const suffix = suffixLen ?? ADDRESS_TRUNCATION.suffix;
  return `${address.slice(0, prefix)}...${address.slice(-suffix)}`;
}

export function getPlantStatusColor(status: number): string {
  switch (status) {
    case 0: return 'status-great'; // Great
    case 1: return 'status-okay'; // Okay
    case 2: return 'status-dry'; // Dry
    case 3: return 'status-dying'; // Dying
    case 4: return 'status-dead'; // Dead
    default: return 'status-unknown';
  }
}

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

export function getFriendlyErrorMessage(error: any): string {
  if (error && typeof error.message === 'string') {
    const message = error.message.toLowerCase();
    if (message.includes('user rejected') || message.includes('request rejected')) {
      return 'You rejected the transaction in your wallet.';
    }
    if (message.includes('insufficient funds')) {
      return 'You have insufficient funds to complete this transaction.';
    }
    if (message.includes('execution reverted')) {
        return 'The transaction failed. Please try again.';
    }
  }
  return 'An unexpected error occurred. Please try again later.';
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

// Static building data for caching
const TOWN_BUILDINGS: { [key: number]: string } = {
  1: "Stake House",
  3: "Ware House", 
  5: "Marketplace",
  7: "Farmer House"
};

const VILLAGE_BUILDINGS: { [key: number]: string } = {
  0: "Solar Panels",
  3: "Soil Factory",
  5: "Bee Farm"
};

// Static icon mapping for caching
const BUILDING_ICON_MAP: { [key: string]: string } = {
  "Solar Panels": "/icons/solar-panels.svg",
  "Soil Factory": "/icons/soil-factory.svg", 
  "Bee Farm": "/icons/bee-house.svg",
  "Stake House": "/icons/stake-house.svg",
  "Ware House": "/icons/ware-house.svg",
  "Marketplace": "/icons/marketplace.svg",
  "Farmer House": "/icons/farmer-house.svg"
};

// Building name and icon caching
const buildingNameCache = new Map<string, string>();
const buildingIconCache = new Map<string, string>();

// Preload building icons for better performance
let iconsPreloaded = false;
let preloadedLinks: HTMLLinkElement[] = [];

export function preloadBuildingIcons(): () => void {
  if (iconsPreloaded) return () => {}; // Return empty cleanup function
  
  const iconPaths = Object.values(BUILDING_ICON_MAP);
  const links: HTMLLinkElement[] = [];
  
  iconPaths.forEach(iconPath => {
    if (typeof window !== 'undefined') {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.href = iconPath;
      link.as = 'image';
      document.head.appendChild(link);
      links.push(link);
    }
  });
  
  preloadedLinks = links;
  iconsPreloaded = true;
  
  // Return cleanup function to remove preload links
  return () => {
    preloadedLinks.forEach(link => {
      if (link.parentNode) {
        link.parentNode.removeChild(link);
      }
    });
    preloadedLinks = [];
    iconsPreloaded = false;
  };
}

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
export function calculateUpgradeProgress(building: any, currentBlock: bigint): number {
  if (!building.isUpgrading) return 0;
  
  const totalBlocks = building.blockHeightUntilUpgradeDone - building.blockHeightUpgradeInitiated;
  const blocksLeft = building.blockHeightUntilUpgradeDone - currentBlock;
  const progress = 100 - (Number(blocksLeft) / Number(totalBlocks)) * 100;
  
  return Math.max(0, Math.min(100, progress));
}

export function calculateTimeLeft(building: any, currentBlock: bigint): string {
  const SECONDS_PER_BLOCK = 2; // Base network: ~2 seconds per block
  const blocksLeft = building.blockHeightUntilUpgradeDone - currentBlock;
  const secondsLeft = Number(blocksLeft) * SECONDS_PER_BLOCK;
  
  if (secondsLeft <= 0) return "Complete";
  
  const hours = Math.floor(secondsLeft / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}



export function getBuildingIcon(buildingName: string): string {
  // Check cache first
  if (buildingIconCache.has(buildingName)) {
    return buildingIconCache.get(buildingName)!;
  }
  
  // Compute icon path
  const iconPath = BUILDING_ICON_MAP[buildingName] || "/icons/stake-house.svg";
  
  // Cache the result
  buildingIconCache.set(buildingName, iconPath);
  return iconPath;
}

export function formatProductionRate(rate: bigint): string {
  const rateValue = Number(rate) / 1e12; // Contract uses 12 decimals for production rates
  return rateValue.toFixed(2);
}

export function formatLifetimeProduction(seconds: bigint): string {
  const hours = Number(seconds) / 3600;
  return `${hours.toFixed(2)} hours`;
}

// Utility function for formatting large numbers with M/K suffixes (used in balance-card and user-stats-service)
export function formatLargeNumber(amount: bigint): string {
  const num = Number(amount) / 1e18;

  if (num >= 1000000) {
    return (num / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.?0+$/, '') + 'K';
  }

  return formatTokenAmount(amount);
}

// Utility function for validating Ethereum addresses (consolidates duplicate validation patterns)
export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Alternative validation using viem's isAddress for cases that need it
export function isValidAddress(address: string | unknown): address is `0x${string}` {
  if (typeof address !== 'string') return false;
  return isValidEthereumAddress(address);
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
  const fenceV1Active = plant.extensions?.some((extension: any) => {
    const owned = extension?.shopItemOwned || [];
    return owned.some((item: any) => {
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
export const getActiveFences = (plant: Plant): Array<{ type: 'Fence V1' | 'Fence V2'; effectUntil: number }> => {
  const active: Array<{ type: 'Fence V1' | 'Fence V2'; effectUntil: number }> = [];
  const now = Math.floor(Date.now() / 1000);

  const fenceV2State = plant.fenceV2 ?? null;
  const fenceV2Active = Boolean(fenceV2State?.isActive && fenceV2State.activeUntil > 0);
  const fenceV2EffectUntil = fenceV2Active ? Number(fenceV2State?.activeUntil ?? 0) : 0;
  const fenceV2Mirroring = Boolean(fenceV2State?.isMirroringV1);

  // Check V1 fences
  if (plant.extensions) {
    for (const extension of plant.extensions) {
      if (!extension.shopItemOwned) continue;
      for (const item of extension.shopItemOwned) {
        if (!item?.effectIsOngoingActive) continue;
        const lowerName = item?.name?.toLowerCase() || '';
        if (!lowerName.includes('fence') && !lowerName.includes('shield')) continue;
        const effectUntil = Number(item.effectUntil || 0);
        if (!Number.isFinite(effectUntil) || effectUntil <= 0) continue;
        // Skip if mirroring V2
        if (fenceV2Active && fenceV2Mirroring && approxTimestampEqual(effectUntil, fenceV2EffectUntil)) {
          continue;
        }
        active.push({ type: 'Fence V1', effectUntil });
        break;
      }
    }
  }

  // Check V2 fence
  if (fenceV2Active) {
    active.push({ type: 'Fence V2', effectUntil: fenceV2EffectUntil });
  }

  // Sort by expiry time (soonest first)
  active.sort((a, b) => a.effectUntil - b.effectUntil);
  return active;
}; 