// Plant strain definitions (mint prices in SEED units)
export const PLANT_STRAINS = [
  { id: 1, name: 'Flora', mintPriceSeed: 10 },
  { id: 2, name: 'Taki', mintPriceSeed: 20 },
  { id: 3, name: 'Rosa', mintPriceSeed: 40 },
  { id: 4, name: 'Zest', mintPriceSeed: 10 },
  { id: 5, name: 'TYJ', mintPriceSeed: 500 },
] as const;

// Plant strain index for quick lookups
export const PLANT_STRAINS_BY_ID = Object.fromEntries(
  PLANT_STRAINS.map(s => [s.id, s])
) as Record<number, typeof PLANT_STRAINS[number]>;

// Plant art assets mapping (strain ID to SVG/PNG path)
export const PLANT_ART_MAP = {
  1: '/icons/plant1.svg',      // Flora
  2: '/icons/plant2.svg',      // Taki
  3: '/icons/plant3WithFrame.svg', // Rosa
  4: '/icons/plant4WithFrame.svg', // Zest
  5: '/icons/plant5.png',      // TYJ
} as const;

// Address formatting constants
export const ADDRESS_TRUNCATION = {
  prefix: 6,
  suffix: 4,
} as const;

// ENS/Basename resolution configuration
export const ENS_CONFIG = {
  CACHE_TTL_SECONDS: 6 * 60 * 60, // 6 hours
  CACHE_PREFIX: 'identity:name:', // Changed from 'ens:name:' for clarity
} as const;

// Building ID to name mappings
export const VILLAGE_BUILDING_NAMES = {
  0: "Solar Panels",
  3: "Soil Factory", 
  5: "Bee Farm"
} as const;

export const TOWN_BUILDING_NAMES = {
  1: "Stake House",
  3: "Ware House",
  5: "Marketplace",
  7: "Farmer House"
} as const;

export const QUEST_DIFFICULTIES = {
  0: "Easy",
  1: "Medium", 
  2: "Hard"
} as const;

export const REWARD_TYPES = {
  0: "SEED",
  1: "LEAF",
  2: "TOD",
  3: "PTS",
  4: "XP"
} as const;

// Building icons mapping
export const BUILDING_ICONS = {
  "Solar Panels": "/icons/solar-panels.svg",
  "Soil Factory": "/icons/soil-factory.svg",
  "Bee Farm": "/icons/bee-house.svg",
  "Stake House": "/icons/stake-house.svg",
  "Ware House": "/icons/ware-house.svg",
  "Marketplace": "/icons/marketplace.svg",
  "Farmer House": "/icons/farmer-house.svg"
} as const;

// Land event icons mapping
export const LAND_EVENT_ICONS = {
  LandTransfer: "/icons/ware-house.svg",
  LandMinted: "/icons/farmer-house.svg",
  LandNameChanged: "/icons/farmer-house.svg",
  VillageUpgradedWithLeaf: "/icons/solar-panels.svg",
  VillageSpeedUpWithSeed: "/icons/solar-panels.svg",
  TownUpgradedWithLeaf: "/icons/marketplace.svg",
  TownSpeedUpWithSeed: "/icons/marketplace.svg",
  QuestStarted: "/icons/stake-house.svg",
  QuestFinalized: "/icons/stake-house.svg",
  VillageProductionClaimed: "/icons/bee-house.svg"
} as const;

// Existing item icons
export const ITEM_ICONS: { [key: string]: string } = {
  "magic soil": "/icons/SOIL.png",
  sunlight: "/icons/SUN.png",
  water: "/icons/WATERDROPS.png",
  fertilizer: "/icons/FERTILIZER.png",
  "dream dew": "/icons/DREAMDEW.png",
  pollinator: "/icons/BEE.png",
  fence: "/icons/Fence.png",
  botano: "/icons/botano.svg",
  moonlight: "/icons/moonlight.svg",
  nitro: "/icons/Nitro.svg",
}; 