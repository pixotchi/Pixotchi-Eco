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
}; 

export const LAND_CONTRACT_ADDRESS = '0x3f1F8F0C4BE4bCeB45E6597AFe0dE861B8c3278c';
export const LEAF_CONTRACT_ADDRESS = '0xE78ee52349D7b031E2A6633E07c037C3147DB116';
export const STAKE_CONTRACT_ADDRESS = '0xF15D93c3617525054aF05338CC6Ccf18886BD03A';
export const PIXOTCHI_TOKEN_ADDRESS = '0x546D239032b24eCEEE0cb05c92FC39090846adc7';
export const VILLAGE_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000000';
export const TOWN_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000000';
export const UNISWAP_ROUTER_ADDRESS = '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86';
export const WETH_ADDRESS = '0x4200000000000000000000000000000000000006'; 