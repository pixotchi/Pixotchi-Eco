// Note: utility helpers such as `cn` live in `lib/utils.ts` to avoid duplication
// Plant data types
export type Plant = {
  id: number;
  name: string;
  score: number;
  status: number;
  rewards: number;
  level: number;
  timeUntilStarving: number;
  stars: number;
  strain: number;
  timePlantBorn: string;
  lastAttackUsed: string;
  lastAttacked: string;
  statusStr: string;
  owner: string;
  extensions: Extension[];
};

export type Extension = {
  shopItemOwned: ShopItemOwned[];
};

export type ShopItemOwned = {
  id: string;
  name: string;
  effectUntil: any;
  effectIsOngoingActive: boolean;
};

// Shop data types
export type ShopItem = {
  id: string;
  name: string;
  price: any;
  effectTime: any;
  description?: string;
  category?: string;
  imageUrl?: string;
};

export type GardenItem = {
  id: string;
  name: string;
  price: any;
  points: number;
  timeExtension: number;
  description?: string;
  category?: string;
};

// Strain data types
export type Strain = {
  id: number;
  name: string;
  mintPrice: number;
  totalSupply: number;
  totalMinted: number;
  maxSupply: number;
  isActive: boolean;
  getStrainTotalLeft: number;
  strainInitialTOD: number;
  description?: string;
  imageUrl?: string;
};

// UI state types
export type Tab = 'dashboard' | 'mint' | 'about' | 'swap' | 'activity' | 'leaderboard';

export type LoadingState = {
  plants: boolean;
  shopItems: boolean;
  strains: boolean;
  minting: boolean;
  purchasing: boolean;
  balance: boolean;
};

// Land data type
export type Land = {
  tokenId: bigint;
  tokenUri: string;
  mintDate: bigint;
  owner: string;
  name: string;
  coordinateX: bigint;
  coordinateY: bigint;
  experiencePoints: bigint;
  accumulatedPlantPoints: bigint;
  accumulatedPlantLifetime: bigint;
  farmerAvatar: number;
};

// Building data types
export type BuildingData = {
  id: number;                                // Building identifier (0,1,3,5,7)
  level: number;                            // Current building level
  maxLevel: number;                         // Maximum possible level
  productionRatePlantPointsPerDay: bigint;  // Points produced per day
  productionRatePlantLifetimePerDay: bigint; // Lifetime hours per day
  accumulatedPoints: bigint;                // Points ready to collect
  accumulatedLifetime: bigint;              // Lifetime ready to collect
  levelUpgradeCostLeaf: bigint;             // LEAF cost for next upgrade
  levelUpgradeCostSeedInstant: bigint;      // SEED cost for instant upgrade
  levelUpgradeBlockInterval: bigint;        // Blocks needed for upgrade
  isUpgrading: boolean;                     // Whether upgrade is in progress
  blockHeightUpgradeInitiated: bigint;      // When upgrade started
  blockHeightUntilUpgradeDone: bigint;      // When upgrade completes
  claimedBlockHeight?: bigint;              // Last claimed block height
};

export type BuildingType = 'village' | 'town';

// Transaction types
export type TransactionStatus = 'idle' | 'pending' | 'success' | 'error';

export type TransactionState = {
  status: TransactionStatus;
  hash?: string;
  error?: string;
};

// MiniKit specific types
export type FrameContext = {
  client: {
    added: boolean;
    clientFid: string;
    notificationDetails?: {
      url: string;
      token: string;
    };
  };
  user: {
    fid: number;
    username?: string;
    displayName?: string;
    pfpUrl?: string;
  };
};

// Component prop types
export type PlantCardProps = {
  plant: Plant;
  onClick?: () => void;
  showDetails?: boolean;
  className?: string;
};

export type StrainCardProps = {
  strain: Strain;
  onSelect: (strain: Strain) => void;
  selected: boolean;
  disabled?: boolean;
};

export type ShopItemCardProps = {
  item: ShopItem;
  onPurchase: (item: ShopItem) => void;
  disabled?: boolean;
  showPrice?: boolean;
};

// Form data types
export type MintFormData = {
  selectedStrain: Strain | null;
  approvalNeeded: boolean;
};

export type PurchaseFormData = {
  selectedPlant: Plant | null;
  selectedItem: ShopItem | null;
  confirmed: boolean;
};

// API response types
export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

// Utility types
export type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;
export type Nullable<T> = T | null;
export type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
}; 

// Invite System Types
export type InviteCode = {
  code: string;           // 8-char alphanumeric
  createdBy: string;      // Wallet address
  createdAt: number;      // Unix timestamp
  usedBy?: string;        // Wallet address of user who used it
  usedAt?: number;        // Unix timestamp when used
  isUsed: boolean;
  expiresAt?: number;     // Optional expiration timestamp
};

export type UserInviteData = {
  address: string;
  totalCodesGenerated: number;
  totalCodesUsed: number;           // How many of their codes were used
  dailyGenerated: number;
  lastGeneratedDate: string;        // YYYY-MM-DD
  invitedUsers: string[];           // Wallet addresses of users they invited
  invitedBy?: string;               // Wallet address of who invited them
  joinedAt: number;                 // Unix timestamp when they joined
};

export type InviteStats = {
  totalInvites: number;
  successfulInvites: number;
  dailyRemaining: number;
  canGenerateToday: boolean;
};

export type InviteValidationResult = {
  valid: boolean;
  code?: InviteCode;
  error?: string;
  errorCode?: 'NOT_FOUND' | 'ALREADY_USED' | 'EXPIRED' | 'INVALID_FORMAT' | 'SELF_INVITE';
};

export type InviteGenerationResult = {
  success: boolean;
  code?: string;
  error?: string;
  errorCode?: 'DAILY_LIMIT_EXCEEDED' | 'GENERATION_FAILED' | 'SYSTEM_DISABLED';
}; 

// Types for Ponder Indexer
export type ActivityEvent = AttackEvent | KilledEvent | MintEvent | PlayedEvent | ItemConsumedEvent | ShopItemPurchasedEvent | LandTransferEvent | LandMintedEvent | LandNameChangedEvent | VillageUpgradedWithLeafEvent | VillageSpeedUpWithSeedEvent | TownUpgradedWithLeafEvent | TownSpeedUpWithSeedEvent | QuestStartedEvent | QuestFinalizedEvent | VillageProductionClaimedEvent;

export type AttackEvent = {
  __typename: "Attack";
  id: string;
  timestamp: string;
  attacker: string;
  winner: string;
  loser: string;
  scoresWon: string;
  attackerName: string;
  winnerName: string;
  loserName: string;
};

export type KilledEvent = {
  __typename: "Killed";
  id: string;
  timestamp: string;
  nftId: string;
  deadId: string;
  killer: string;
  winnerName: string;
  loserName: string;
  reward: string;
};

export type MintEvent = {
  __typename: "Mint";
  id: string;
  timestamp: string;
  nftId: string;
};

export type PlayedEvent = {
  __typename: "Played";
  id:string;
  timestamp: string;
  nftId: string;
  nftName: string;
  points: string;
  timeExtension: string;
  gameName: string;
};

export type ItemConsumedEvent = {
  __typename: "ItemConsumed";
  id: string;
  timestamp: string;
  nftId: string;
  nftName: string;
  giver: string;
  itemId: string;
};

export type ShopItemPurchasedEvent = {
  __typename: "ShopItemPurchased";
  id: string;
  timestamp: string;
  nftId: string;
  nftName: string;
  giver: string;
  itemId: string;
};

// Land Event Types
export type LandTransferEvent = {
  __typename: "LandTransferEvent";
  id: string;
  timestamp: string;
  from: string;
  to: string;
  tokenId: string;
  blockHeight: string;
};

export type LandMintedEvent = {
  __typename: "LandMintedEvent";
  id: string;
  timestamp: string;
  to: string;
  tokenId: string;
  mintPrice: string;
  blockHeight: string;
};

export type LandNameChangedEvent = {
  __typename: "LandNameChangedEvent";
  id: string;
  timestamp: string;
  tokenId: string;
  name: string;
  blockHeight: string;
};

export type VillageUpgradedWithLeafEvent = {
  __typename: "VillageUpgradedWithLeafEvent";
  id: string;
  timestamp: string;
  landId: string;
  buildingId: number;
  upgradeCost: string;
  xp: string;
  blockHeight: string;
};

export type VillageSpeedUpWithSeedEvent = {
  __typename: "VillageSpeedUpWithSeedEvent";
  id: string;
  timestamp: string;
  landId: string;
  buildingId: number;
  speedUpCost: string;
  xp: string;
  blockHeight: string;
};

export type TownUpgradedWithLeafEvent = {
  __typename: "TownUpgradedWithLeafEvent";
  id: string;
  timestamp: string;
  landId: string;
  buildingId: number;
  upgradeCost: string;
  xp: string;
  blockHeight: string;
};

export type TownSpeedUpWithSeedEvent = {
  __typename: "TownSpeedUpWithSeedEvent";
  id: string;
  timestamp: string;
  landId: string;
  buildingId: number;
  speedUpCost: string;
  xp: string;
  blockHeight: string;
};

export type QuestStartedEvent = {
  __typename: "QuestStartedEvent";
  id: string;
  timestamp: string;
  landId: string;
  farmerSlotId: string;
  difficulty: number;
  startBlock: string;
  endBlock: string;
  blockHeight: string;
};

export type QuestFinalizedEvent = {
  __typename: "QuestFinalizedEvent";
  id: string;
  timestamp: string;
  landId: string;
  farmerSlotId: string;
  player: string;
  rewardType: number;
  amount: string;
  blockHeight: string;
};

export type VillageProductionClaimedEvent = {
  __typename: "VillageProductionClaimedEvent";
  id: string;
  timestamp: string;
  landId: string;
  buildingId: number;
  blockHeight: string;
};

// Enhanced type for bundled item consumption
export type BundledItemConsumedEvent = ItemConsumedEvent & {
  quantity: number;
};

// Chat system types
export type CastShareData = {
  hash: string;
  author: {
    fid: number;
    username?: string;
    displayName?: string;
    pfpUrl?: string;
  };
  text?: string;
  timestamp?: number;
  channelKey?: string;
  embeds?: string[];
};

export type ChatMessage = {
  id: string;
  address: string;
  message: string;
  timestamp: number;
  displayName: string; // Fallback display name, OnchainKit handles real names client-side
  type?: 'text' | 'cast_share'; // Type of message (backwards compatible, defaults to 'text')
  castData?: CastShareData; // Cast data if type is 'cast_share'
};

export type ChatRateLimit = {
  lastMessage: number;
  messageCount: number;
};

export type ChatStats = {
  totalMessages: number;
  activeUsers: number;
  messagesLast24h: number;
};

export type AdminChatMessage = ChatMessage & {
  isSpam?: boolean;
  similarCount?: number;
  type?: 'text' | 'cast_share'; // Inherited from ChatMessage but explicit for admin
  castData?: CastShareData; // Inherited from ChatMessage but explicit for admin
};

// AI Chat Types
export type ChatMode = 'public' | 'ai' | 'agent';

export type AIChatMessage = {
  id: string;
  conversationId: string;
  address: string;
  message: string;
  timestamp: number;
  type: 'user' | 'assistant';
  model: string;
  tokensUsed?: number;
  displayName: string;
};

export type AIConversation = {
  id: string;
  address: string;
  title: string;
  createdAt: number;
  lastMessageAt: number;
  messageCount: number;
  model: string;
  totalTokens: number;
};

export type AIProvider = 'openai' | 'claude';

export type AIUsageStats = {
  totalConversations: number;
  totalMessages: number;
  totalTokens: number;
  dailyUsage: number;
  costEstimate: number;
};

export type AICostMetrics = {
  date: string;
  messages: number;
  tokens: number;
  estimatedCost: number;
}; 