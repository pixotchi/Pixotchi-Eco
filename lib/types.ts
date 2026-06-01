// Note: utility helpers such as `cn` live in `lib/utils.ts` to avoid duplication
// Plant data types
export type FenceV2State = {
  activeUntil: number;
  isActive: boolean;
  v1Active: boolean;
  totalDaysPurchased: number;
  quotedDays?: number | null;
  isMirroringV1?: boolean;
};

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
  fenceV2?: FenceV2State | null;
};

export type Extension = {
  shopItemOwned: ShopItemOwned[];
};

export type ShopItemOwned = {
  id: string;
  name: string;
  effectUntil: UntypedValue;
  effectIsOngoingActive: boolean;
};

// Shop data types
export type ShopItem = {
  id: string;
  name: string;
  price: UntypedValue;
  effectTime: UntypedValue;
  description?: string;
  category?: string;
  imageUrl?: string;
};

export type GardenItem = {
  id: string;
  name: string;
  price: UntypedValue;
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
  paymentToken?: `0x${string}`; // Token address for payment (if different from SEED)
  paymentPrice?: bigint; // Price in the payment token (raw bigint for precision)
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
  levelUpgradeCostSeed?: bigint;            // SEED cost for normal upgrade (Town only)
  isUpgrading: boolean;                     // Whether upgrade is in progress
  blockHeightUpgradeInitiated: bigint;      // When upgrade started
  blockHeightUntilUpgradeDone: bigint;      // When upgrade completes
  claimedBlockHeight?: bigint;              // Last claimed block height
};

export type BuildingType = 'village' | 'town';

export type BarracksConfig = {
  initialized: boolean;
  enabled: boolean;
  buildToken: string;
  buildCost: bigint;
  buildReceiver: string;
  trainingToken: string;
  trainingCost: bigint;
  trainingReceiver: string;
  trainingTimePerTroop: bigint;
  attackCooldown: bigint;
  defenseCooldown: bigint;
  lootPercentageBps: number;
  casualtyScaleBps: number;
  successfulRaidXP: bigint;
  successfulDefenseXP: bigint;
  troopAttackStrength: bigint;
  troopDefenseStrength: bigint;
  troopCarryPoints: bigint;
  troopCarryLifetime: bigint;
  maxTroopsPerLand: bigint;
};

export type BarracksTroopId = 'swordsman' | 'phalanx';

export type BarracksTroopConfigV2 = {
  trainingToken: string;
  trainingCost: bigint;
  trainingReceiver: string;
  trainingTimePerTroop: bigint;
  troopAttackStrength: bigint;
  troopDefenseStrength: bigint;
  troopCarryPoints: bigint;
  troopCarryLifetime: bigint;
  maxTroopsPerLand: bigint;
};

export type BarracksConfigV2 = {
  initialized: boolean;
  enabled: boolean;
  buildToken: string;
  buildCost: bigint;
  buildReceiver: string;
  attackCooldown: bigint;
  defenseCooldown: bigint;
  lootPercentageBps: number;
  casualtyScaleBps: number;
  successfulRaidXP: bigint;
  successfulDefenseXP: bigint;
  swordsman: BarracksTroopConfigV2;
  phalanx: BarracksTroopConfigV2;
};

export type BarracksLandState = {
  isBuilt: boolean;
  stationedTroops: bigint;
  trainingQueueAmount: bigint;
  readyToClaimTroops: bigint;
  trainingStartedAt: bigint;
  trainingEndsAt: bigint;
  nextTroopReadyAt: bigint;
  lastAttackAt: bigint;
  lastDefendedAt: bigint;
  attackCooldownEndsAt: bigint;
  defenseCooldownEndsAt: bigint;
  totalTroops: bigint;
};

export type BarracksLandStateV2 = {
  isBuilt: boolean;
  stationedSwordsmanTroops: bigint;
  stationedPhalanxTroops: bigint;
  trainingQueueTroopType: number;
  trainingQueueAmount: bigint;
  readyToClaimSwordsmanTroops: bigint;
  readyToClaimPhalanxTroops: bigint;
  trainingStartedAt: bigint;
  trainingEndsAt: bigint;
  nextTroopReadyAt: bigint;
  lastAttackAt: bigint;
  lastDefendedAt: bigint;
  attackCooldownEndsAt: bigint;
  defenseCooldownEndsAt: bigint;
  totalSwordsmanTroops: bigint;
  totalPhalanxTroops: bigint;
};

export type BarracksRaidReport = {
  raidId: bigint;
  timestamp: bigint;
  attackerLandId: bigint;
  defenderLandId: bigint;
  attackerWon: boolean;
  troopsSent: bigint;
  attackerTroopsBefore: bigint;
  defenderTroopsBefore: bigint;
  attackerTroopsLost: bigint;
  defenderTroopsLost: bigint;
  survivingAttackers: bigint;
  survivingDefenders: bigint;
  attackerPower: bigint;
  defenderPower: bigint;
  pendingPointsSettled: bigint;
  pendingLifetimeSettled: bigint;
  pointsStolen: bigint;
  lifetimeStolen: bigint;
};

export type BarracksRaidReportV2 = {
  raidId: bigint;
  timestamp: bigint;
  attackerLandId: bigint;
  defenderLandId: bigint;
  attackerWon: boolean;
  swordsmenSent: bigint;
  phalanxSent: bigint;
  attackerSwordsmenBefore: bigint;
  attackerPhalanxBefore: bigint;
  defenderSwordsmenBefore: bigint;
  defenderPhalanxBefore: bigint;
  attackerSwordsmenLost: bigint;
  attackerPhalanxLost: bigint;
  defenderSwordsmenLost: bigint;
  defenderPhalanxLost: bigint;
  survivingAttackerSwordsmen: bigint;
  survivingAttackerPhalanx: bigint;
  survivingDefenderSwordsmen: bigint;
  survivingDefenderPhalanx: bigint;
  attackerPower: bigint;
  defenderPower: bigint;
  pendingPointsSettled: bigint;
  pendingLifetimeSettled: bigint;
  pointsStolen: bigint;
  lifetimeStolen: bigint;
};

export type BarracksRaidPreview = {
  statusCode: number;
  attackerWon: boolean;
  troopsRequested: bigint;
  attackerTroopsBefore: bigint;
  defenderTroopsBefore: bigint;
  attackerTroopsLost: bigint;
  defenderTroopsLost: bigint;
  survivingAttackers: bigint;
  survivingDefenders: bigint;
  attackerPower: bigint;
  defenderPower: bigint;
  pendingPoints: bigint;
  pendingLifetime: bigint;
  carryPointsCap: bigint;
  carryLifetimeCap: bigint;
  estimatedPointsLoot: bigint;
  estimatedLifetimeLoot: bigint;
  attackerCooldownEndsAt: bigint;
  defenderCooldownEndsAt: bigint;
};

export type BarracksRaidPreviewV2 = {
  statusCode: number;
  attackerWon: boolean;
  swordsmenRequested: bigint;
  phalanxRequested: bigint;
  attackerSwordsmenBefore: bigint;
  attackerPhalanxBefore: bigint;
  defenderSwordsmenBefore: bigint;
  defenderPhalanxBefore: bigint;
  attackerSwordsmenLost: bigint;
  attackerPhalanxLost: bigint;
  defenderSwordsmenLost: bigint;
  defenderPhalanxLost: bigint;
  survivingAttackerSwordsmen: bigint;
  survivingAttackerPhalanx: bigint;
  survivingDefenderSwordsmen: bigint;
  survivingDefenderPhalanx: bigint;
  attackerPower: bigint;
  defenderPower: bigint;
  pendingPoints: bigint;
  pendingLifetime: bigint;
  carryPointsCap: bigint;
  carryLifetimeCap: bigint;
  estimatedPointsLoot: bigint;
  estimatedLifetimeLoot: bigint;
  attackerCooldownEndsAt: bigint;
  defenderCooldownEndsAt: bigint;
};

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
export type ActivityEvent = AttackEvent | KilledEvent | MintEvent | PlayedEvent | ItemConsumedEvent | ShopItemPurchasedEvent | LandTransferEvent | LandMintedEvent | LandNameChangedEvent | VillageUpgradedWithLeafEvent | VillageSpeedUpWithSeedEvent | TownUpgradedWithLeafEvent | TownSpeedUpWithSeedEvent | QuestStartedEvent | QuestFinalizedEvent | VillageProductionClaimedEvent | BarracksBuiltEvent | BarracksRaidEvent | CasinoBuiltEvent | RouletteSpinResultEvent | BlackjackResultEvent;

export type GameKnowledgeTopic = {
  aliases: string[];
  canRead: string[];
  cannotDo: string[];
  deferralText: string;
  id: string;
  liveDataSources: string[];
  purpose: string;
  stalenessRules: string[];
  title: string;
  userFlows: string[];
  where: string;
};

export type NormalizedOnchainActivity = {
  amountDisplay?: string;
  assetType: 'plant' | 'land' | 'token' | 'native' | 'game' | 'unknown';
  blockNumber?: string;
  confidence: 'high' | 'medium' | 'low';
  counterparty?: string;
  direction?: 'in' | 'out' | 'self' | 'unknown';
  kind: string;
  source: string;
  timestamp?: string;
  token?: string;
  tokenId?: string;
  txHash?: string;
};

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
  id: string;
  timestamp: string;
  nftId: string;
  nftName: string;
  points: string;
  timeExtension: string;
  gameName: string;
  rewardIndex?: string;
  timeAdded?: string;
  leafAmount?: string;
  player?: string;
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

export type BarracksBuiltEvent = {
  __typename: "BarracksBuiltEvent";
  id: string;
  timestamp: string;
  landId: string;
  builder: string;
  token: string;
  cost: string;
  blockHeight: string;
};

export type BarracksRaidEvent = {
  __typename: "BarracksRaidEvent";
  id: string;
  timestamp: string;
  raidId: string;
  attackerLandId: string;
  defenderLandId: string;
  attackerWon: boolean;
  blockHeight: string;
};

// Casino/Roulette Event Types
export type CasinoBuiltEvent = {
  __typename: "CasinoBuiltEvent";
  id: string;
  timestamp: string;
  landId: string;
  builder: string;
  token: string;
  cost: string;
  blockHeight: string;
};

export type RouletteSpinResultEvent = {
  __typename: "RouletteSpinResultEvent";
  id: string;
  timestamp: string;
  landId: string;
  player: string;
  winningNumber: number;
  won: boolean;
  payout: string;
  bettingToken: string;
  blockHeight: string;
};

// Blackjack Event Types
// GameResult enum: 0=NONE, 1=PLAYER_WIN, 2=DEALER_WIN, 3=PUSH, 4=PLAYER_BUST, 5=DEALER_BUST, 6=PLAYER_BLACKJACK, 7=DEALER_BLACKJACK, 8=SURRENDERED
export type BlackjackResultEvent = {
  __typename: "BlackjackResultEvent";
  id: string;
  timestamp: string;
  landId: string;
  player: string;
  result: number; // GameResult enum value
  playerFinalValue: number;
  dealerFinalValue: number;
  payout: string;
  bettingToken: string;
  blockHeight: string;
};

// Enhanced type for bundled item consumption
export type BundledItemConsumedEvent = ItemConsumedEvent & {
  quantity: number;
};

// Chat system types
export type ChatMessage = {
  id: string;
  address: string;
  message: string;
  timestamp: number;
  displayName: string; // Fallback display name, OnchainKit handles real names client-side
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
};

// AI Chat Types
export type ChatMode = 'public' | 'ai';

export type AIToolCallTrace = {
  error?: string;
  freshness?: {
    blockNumber?: string;
    cache?: string;
    fetchedAt?: string;
  };
  input?: UntypedValue;
  source?: string;
  status: 'ok' | 'error' | 'unknown';
  toolName: string;
};

export type AIChatMessage = {
  id: string;
  conversationId: string;
  address: string;
  continuations?: number;
  finishReason?: string;
  message: string;
  timestamp: number;
  type: 'user' | 'assistant';
  model: string;
  outputTokens?: number;
  provider?: string;
  recoveredFromLength?: boolean;
  tokensUsed?: number;
  displayName: string;
  toolCalls?: AIToolCallTrace[];
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

export type AIProvider = 'openai' | 'claude' | 'google' | 'gateway';

export type AIUsageStats = {
  totalConversations: number;
  totalMessages: number;
  totalTokens: number;
  dailyUsage: number;
  costEstimate: number;
  continuationCount?: number;
  lengthFinishCount?: number;
  recoveredFromLengthCount?: number;
  reasoningTokens?: number;
};

export type AICostMetrics = {
  date: string;
  messages: number;
  tokens: number;
  estimatedCost: number;
};

// Transaction types - consolidated from multiple transaction component files
export interface TransactionCall {
  address: `0x${string}`;
  abi: UntypedValue;
  functionName: string;
  args: UntypedValue[];
  value?: bigint;
}

// Notification types - consolidated from notification.ts and notification-client.ts
export type FrameNotificationDetails = {
  url: string;
  token: string;
};

// Mint share data types - consolidated from multiple files
export interface MintShareData {
  address: string;
  basename?: string;
  strain?: string; // from share/m/[id]/page.tsx
  strainName?: string; // from mint-share-modal.tsx
  strainId?: number; // from mint-share-modal.tsx
  name?: string; // from share/m/[id]/page.tsx
  mintedAt: string;
  tx?: string; // from share/m/[id]/page.tsx
  txHash?: string; // from mint-share-modal.tsx
} 
