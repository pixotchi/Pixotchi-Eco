// Plant strain definitions. TYJ is paid in JESSE; standard strains use SEED.
export const PLANT_STRAINS = [
  { id: 1, name: 'Flora', mintPriceSeed: 10, paymentTokenSymbol: 'SEED', priceDisplay: '10 SEED' },
  { id: 2, name: 'Taki', mintPriceSeed: 20, paymentTokenSymbol: 'SEED', priceDisplay: '20 SEED' },
  { id: 3, name: 'Rosa', mintPriceSeed: 40, paymentTokenSymbol: 'SEED', priceDisplay: '40 SEED' },
  { id: 4, name: 'Zest', mintPriceSeed: 10, paymentTokenSymbol: 'SEED', priceDisplay: '10 SEED' },
  { id: 5, name: 'TYJ', paymentTokenSymbol: 'JESSE', priceDisplay: '500 JESSE' },
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
  moonlight: "/icons/moonlight.png",
  nitro: "/icons/Nitro.png",
}; 
