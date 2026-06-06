import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  gateway,
  generateText,
  stepCountIs,
  streamText,
  type FinishReason,
  type GatewayModelId,
  type UIMessage,
} from 'ai';
import { nanoid } from 'nanoid';
import { getCurrentAIProvider,getCurrentModelConfig,validateAIConfig } from './ai-config';
import { generateConversationTitle, READ_ONLY_AGENT_SYSTEM_PROMPT } from './ai-context';
import { createReadOnlyAITools } from './ai-read-tools';
import { classifyAIUserMessage } from './ai-safety';
import { formatDisplayName } from './chat-service';
import { redis,redisScanKeysRaw } from './redis';
import { AIChatMessage,AIConversation,AIUsageStats,AIToolCallTrace } from './types';

const AI_MESSAGE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
const AI_RATE_LIMIT_TTL = 60 * 60; // 1 hour in seconds
const AI_USAGE_TTL = 24 * 60 * 60; // 24 hours in seconds

// Rate limiting configuration
const AI_RATE_LIMIT_WINDOW = 10; // 10 seconds between AI messages
const MAX_AI_MESSAGE_LENGTH = 300;
const MIN_AI_MESSAGE_LENGTH = 2;
const MAX_AI_MESSAGES_PER_DAY = parseInt(process.env.AI_MAX_MESSAGES_PER_DAY || '', 10) || 100;
const MAX_AI_TOKENS_PER_DAY = parsePositiveInteger(process.env.AI_MAX_TOKENS_PER_DAY, 1_000_000);
const AI_REQUEST_TIMEOUT_MS = parseInt(process.env.AI_REQUEST_TIMEOUT_MS || '', 10) || 45_000;
const AI_STEP_TIMEOUT_MS = parseInt(process.env.AI_STEP_TIMEOUT_MS || '', 10) || 25_000;
const AI_TEMPERATURE = Number.isFinite(Number(process.env.AI_TEMPERATURE))
  ? Number(process.env.AI_TEMPERATURE)
  : 0.2;
const AI_PLANNING_MAX_OUTPUT_TOKENS = parsePositiveInteger(process.env.AI_PLANNING_MAX_OUTPUT_TOKENS, 1_024);
const AI_CONTINUATION_MAX_OUTPUT_TOKENS = parsePositiveInteger(process.env.AI_CONTINUATION_MAX_OUTPUT_TOKENS, 2_048);
const AI_SOFT_BUDGET_RATIO = parseNumberInRange(process.env.AI_SOFT_BUDGET_RATIO, 0.75, 0.1, 0.95);
const AI_SOFT_BUDGET_MAX_OUTPUT_TOKENS = parsePositiveInteger(process.env.AI_SOFT_BUDGET_MAX_OUTPUT_TOKENS, 1_024);
const AI_AUTO_CONTINUE_ON_LENGTH = parseBoolean(process.env.AI_AUTO_CONTINUE_ON_LENGTH, true);
const AI_TOOL_CONTEXT_MAX_CHARS = parsePositiveInteger(process.env.AI_TOOL_CONTEXT_MAX_CHARS, 12_000);
const AI_TOOL_CONTEXT_MAX_CHARS_PER_TOOL = parsePositiveInteger(process.env.AI_TOOL_CONTEXT_MAX_CHARS_PER_TOOL, 2_800);
const AI_GOOGLE_THINKING_LEVEL = normalizeGoogleThinkingLevel(process.env.AI_GOOGLE_THINKING_LEVEL);
const AI_GOOGLE_THINKING_BUDGET = parseNonNegativeInteger(process.env.AI_GOOGLE_THINKING_BUDGET, 0);
const TRACE_SECRET_KEY_PATTERN = /(api|auth|bearer|cookie|jwt|key|mnemonic|password|private|secret|session|signature|token)/i;
const TOOL_TRACE_MAX_DEPTH = 4;
const TOOL_TRACE_MAX_ARRAY_ITEMS = 10;
const TOOL_TRACE_MAX_OBJECT_KEYS = 20;
const TOOL_TRACE_MAX_STRING_LENGTH = 220;
const TRUNCATED_RESPONSE_NOTICE = 'I hit my response limit; ask me to continue for more detail.';

type StoreAIMessageOptions = {
  continuations?: number;
  finishReason?: string;
  messageId?: string;
  outputTokens?: number;
  provider?: string;
  recoveredFromLength?: boolean;
  toolCalls?: AIToolCallTrace[];
};

type SendAIMessageOptions = {
  abortSignal?: AbortSignal;
  sourceAddress?: string | null;
};

type StreamAIMessageOptions = {
  abortSignal?: AbortSignal;
  conversationId?: string | null;
  originalMessages?: PixotchiAIUIMessage[];
  sourceAddress?: string | null;
};

type AIUsageTrackingOptions = {
  continuations?: number;
  finishReason?: string;
  inputTokens?: number;
  lengthFinishes?: number;
  model?: string;
  outputTokens?: number;
  provider?: string;
  reasoningTokens?: number;
  recoveredFromLength?: boolean;
};

type AIRequestBudget = {
  autoContinueOnLength: boolean;
  continuationMaxOutputTokens: number;
  hardStopReason?: string;
  maxOutputTokens: number;
  mode: 'normal' | 'soft' | 'blocked';
  planningMaxOutputTokens: number;
  remainingTokens: number;
  responseInstruction: string;
  usage: {
    messages: number;
    tokens: number;
  };
};

export type PixotchiAIMessageMetadata = {
  continuations?: number;
  conversationId?: string;
  finishReason?: string;
  model?: string;
  persistedMessageId?: string;
  provider?: string;
  recoveredFromLength?: boolean;
  tokensUsed?: number;
  toolCalls?: AIToolCallTrace[];
};

export type PixotchiAIUIMessage = UIMessage<PixotchiAIMessageMetadata>;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseNumberInRange(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (/^(1|true|yes|on)$/i.test(value)) {
    return true;
  }

  if (/^(0|false|no|off)$/i.test(value)) {
    return false;
  }

  return fallback;
}

function normalizeGoogleThinkingLevel(value: string | undefined): 'minimal' | 'low' | 'medium' | 'high' {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }

  return 'minimal';
}

// Provider instances
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

// Helper to get the SDK model instance
export function getSDKModel() {
  const providerName = getCurrentAIProvider();
  const config = getCurrentModelConfig();

  if (providerName === 'openai') {
    return openai(config.model);
  } else if (providerName === 'claude') {
    // Note: @ai-sdk/anthropic handles cache control automatically if headers/structured prompts are used,
    // but we will rely on its standard behavior for now.
    return anthropic(config.model);
  } else if (providerName === 'google') {
    return google(config.model);
  } else if (providerName === 'gateway') {
    return gateway(config.model as GatewayModelId);
  }
  throw new Error(`Unknown provider: ${providerName}`);
}

export function getAIProviderOptions(address?: string) {
  const config = getCurrentModelConfig();
  const googleOptions = getGoogleProviderOptions(config.model, config.provider);

  if (config.provider === 'gateway') {
    return {
      gateway: {
        ...(config.fallbackModels.length ? { models: [config.model, ...config.fallbackModels] } : {}),
        ...(address ? { user: address.toLowerCase() } : {}),
        tags: ['pixotchi', 'neural-seed'],
        zeroDataRetention: true,
      },
      ...(googleOptions ? { google: googleOptions } : {}),
    };
  }

  if (config.provider === 'google' && googleOptions) {
    return { google: googleOptions };
  }

  return undefined;
}

function getGoogleProviderOptions(model: string, provider: string): UntypedValue | undefined {
  const gatewayMayUseGoogle = provider === 'gateway';
  const directGoogle = provider === 'google';
  const configuredGoogleModel = /^google\/gemini-/i.test(model) || /^gemini-/i.test(model);

  if (!directGoogle && !gatewayMayUseGoogle && !configuredGoogleModel) {
    return undefined;
  }

  const models = [
    model,
    ...getCurrentModelConfig().fallbackModels,
  ];
  const hasGemini3 = models.some((entry) => /(?:^|\/)gemini-3/i.test(entry));
  const hasGemini25 = models.some((entry) => /(?:^|\/)gemini-2\.5/i.test(entry));

  if (hasGemini3) {
    return {
      thinkingConfig: {
        thinkingLevel: AI_GOOGLE_THINKING_LEVEL,
      },
    };
  }

  if (hasGemini25) {
    return {
      thinkingConfig: {
        thinkingBudget: AI_GOOGLE_THINKING_BUDGET,
      },
    };
  }

  return undefined;
}

function isDirectGoogleGemini3Model(): boolean {
  const config = getCurrentModelConfig();
  return config.provider === 'google' && /^gemini-3/i.test(config.model);
}

function getModelRequestSettings() {
  return isDirectGoogleGemini3Model()
    ? {}
    : { temperature: AI_TEMPERATURE };
}

const TOOL_PROMPT_PRIORITY = [
  'get_player_overview',
  'get_daily_task_plan',
  'get_wallet_token_balances',
  'get_wallet_game_assets',
  'get_land_production_audit',
  'get_wallet_game_activity',
  'get_combat_activity',
  'get_transaction_status',
  'get_plants',
  'get_killable_plants',
  'get_attack_targets',
  'get_land_raid_targets',
  'get_game_prices',
  'get_lands',
  'get_casino_status',
  'get_marketplace_orders',
  'get_claim_eligibility',
  'get_known_allowances',
  'get_bridge_status',
  'get_app_status',
  'get_game_action_guide',
  'get_token_info',
  'get_seed_market_pulse',
  'get_staking',
  'get_swap_quote',
  'get_missions',
  'get_leaderboards',
  'get_activity',
];

function getToolPriority(toolName: string): number {
  const index = TOOL_PROMPT_PRIORITY.indexOf(toolName);
  return index === -1 ? TOOL_PROMPT_PRIORITY.length : index;
}

function capString(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function compactToolPromptValue(toolName: string, output: UntypedValue): UntypedValue {
  const data = output?.data;

  if (output?.status === 'error') {
    return {
      error: output.error,
      freshness: output.freshness,
      status: output.status,
    };
  }

  if (toolName === 'get_game_prices') {
    return {
      fence: data?.fence,
      gardenItems: (data?.gardenItems || []).slice(0, 8).map((item: UntypedValue) => ({
        id: item.id,
        name: item.name,
        points: item.points,
        priceDisplay: item.priceDisplay,
        timeExtensionSeconds: item.timeExtensionSeconds,
      })),
      landMintPrice: data?.landMintPrice?.priceDisplay,
      revivePrice: data?.revivePrice?.priceDisplay,
      shopItems: (data?.shopItems || []).slice(0, 8).map((item: UntypedValue) => ({
        effectTimeSeconds: item.effectTimeSeconds,
        id: item.id,
        name: item.name,
        priceDisplay: item.priceDisplay,
      })),
      strains: (data?.strains || []).map((strain: UntypedValue) => ({
        active: strain.active,
        id: strain.id,
        isMintable: strain.isMintable,
        name: strain.name,
        priceDisplay: strain.priceDisplay,
        remainingSupply: strain.remainingSupply,
      })),
    };
  }

  if (toolName === 'get_player_overview') {
    return {
      balances: data?.balances,
      landSummary: data?.landSummary,
      plantSummary: data?.plantSummary,
      urgentPlants: (data?.urgentPlants || []).slice(0, 6),
    };
  }

  if (toolName === 'get_wallet_token_balances') {
    return {
      address: data?.address,
      knownTokensOnly: data?.knownTokensOnly,
      tokens: (data?.tokens || []).map((token: UntypedValue) => ({
        address: token.address,
        amountDisplay: token.amountDisplay,
        id: token.id,
        symbol: token.symbol,
      })),
    };
  }

  if (toolName === 'get_wallet_game_assets') {
    return {
      address: data?.address,
      landSummary: data?.landSummary,
      lands: (data?.lands || []).slice(0, 8).map((land: UntypedValue) => ({
        coordinates: land.coordinates,
        id: land.id,
        name: land.name,
        storedLifetimeHours: land.storedLifetimeHours,
        storedPts: land.storedPts,
      })),
      plantSummary: data?.plantSummary,
      plants: (data?.plants || []).slice(0, 8).map((plant: UntypedValue) => ({
        fence: plant.fence,
        id: plant.id,
        level: plant.level,
        name: plant.name,
        rewardsEth: plant.rewardsEth,
        scorePts: plant.scorePts,
        stars: plant.stars,
        statusLabel: plant.statusLabel,
        strainName: plant.strainName,
        timeUntilStarvingHours: plant.timeUntilStarvingHours,
      })),
      truncated: data?.truncated,
      urgentPlants: (data?.urgentPlants || []).slice(0, 6),
    };
  }

  if (toolName === 'get_wallet_game_activity') {
    const compactActivity = (entry: UntypedValue) => ({
      amountDisplay: entry.amountDisplay,
      assetType: entry.assetType,
      blockNumber: entry.blockNumber,
      confidence: entry.confidence,
      counterparty: entry.counterparty,
      direction: entry.direction,
      kind: entry.kind,
      source: entry.source,
      timestamp: entry.timestamp,
      token: entry.token,
      tokenId: entry.tokenId,
      txHash: entry.txHash,
    });
    return {
      address: data?.address,
      combined: (data?.combined || []).slice(0, 12).map(compactActivity),
      errors: data?.errors,
      indexedRecentEvents: (data?.indexedRecentEvents || []).slice(0, 8).map(compactActivity),
      onchainTransfers: (data?.onchainTransfers || []).slice(0, 8).map(compactActivity),
      rpcFallback: data?.rpcFallback,
      rpcBlockRange: data?.rpcBlockRange,
      truncated: data?.truncated,
    };
  }

  if (toolName === 'get_combat_activity') {
    return {
      direction: data?.direction,
      fromTimestampIso: data?.fromTimestampIso,
      includedSystems: data?.includedSystems,
      landIdsChecked: data?.landIdsChecked,
      plantIdsChecked: data?.plantIdsChecked,
      summary: data?.summary,
      timeframeHours: data?.timeframeHours,
      toTimestampIso: data?.toTimestampIso,
      truncationNote: data?.truncationNote,
      recentEvents: (data?.combined || []).slice(0, 12).map((event: UntypedValue) => ({
        attacker: event.attacker,
        attackerLandId: event.attackerLandId,
        attackerWon: event.attackerWon,
        defenderLandId: event.defenderLandId,
        direction: event.direction,
        kind: event.kind,
        outcomeForUser: event.outcomeForUser,
        scoresWonPts: event.scoresWonPts,
        target: event.target,
        timestampIso: event.timestampIso,
      })),
      truncated: data?.truncated,
    };
  }

  if (toolName === 'get_transaction_status') {
    return {
      blockNumber: data?.blockNumber,
      found: data?.found,
      from: data?.from,
      gasUsed: data?.gasUsed,
      knownPixotchiEvents: (data?.knownPixotchiEvents || []).slice(0, 12),
      pixotchiLogCount: data?.pixotchiLogCount,
      status: data?.status,
      timestamp: data?.timestamp,
      to: data?.to,
      txHash: data?.txHash,
      valueEth: data?.valueEth,
    };
  }

  if (toolName === 'get_plants') {
    return {
      count: data?.count,
      plants: (data?.plants || []).slice(0, 12).map((plant: UntypedValue) => ({
        fence: plant.fence,
        id: plant.id,
        level: plant.level,
        name: plant.name,
        rewardsEth: plant.rewardsEth,
        scorePts: plant.scorePts,
        stars: plant.stars,
        statusLabel: plant.statusLabel,
        strainName: plant.strainName,
        timeUntilStarvingHours: plant.timeUntilStarvingHours,
      })),
      summary: data?.summary,
      totalOwned: data?.totalOwned,
      truncated: data?.truncated,
    };
  }

  if (toolName === 'get_attack_targets') {
    return {
      blockedSummary: data?.blockedSummary,
      eligibleTargetCount: data?.eligibleTargetCount,
      ownedPlantCount: data?.ownedPlantCount,
      readyAttackerCount: data?.readyAttackerCount,
      rules: data?.rules,
      scannedLeaderboardCount: data?.scannedLeaderboardCount,
      targets: (data?.targets || []).slice(0, 10),
      totalLeaderboardPlants: data?.totalLeaderboardPlants,
      truncated: data?.truncated,
    };
  }

  if (toolName === 'get_killable_plants') {
    return {
      blockedSummary: data?.blockedSummary,
      deadTargetCount: data?.deadTargetCount,
      killCooldown: data?.killCooldown,
      livingKillerCount: data?.livingKillerCount,
      livingKillerPlants: (data?.livingKillerPlants || []).slice(0, 6),
      ownedPlantCount: data?.ownedPlantCount,
      readiness: data?.readiness,
      rules: data?.rules,
      scannedLeaderboardCount: data?.scannedLeaderboardCount,
      targets: (data?.targets || []).slice(0, 10),
      totalLeaderboardPlants: data?.totalLeaderboardPlants,
      truncated: data?.truncated,
    };
  }

  if (toolName === 'get_land_raid_targets') {
    return {
      barracksConfig: data?.barracksConfig,
      blocked: data?.blocked,
      checkedLandCount: data?.checkedLandCount,
      ownedLandCount: data?.ownedLandCount,
      readyAttackerCount: data?.readyAttackerCount,
      results: (data?.results || []).slice(0, 6).map((entry: UntypedValue) => ({
        attacker: entry.attacker,
        eligibleTargetCount: entry.eligibleTargetCount,
        previewTroopsUsed: entry.previewTroopsUsed,
        previews: (entry.previews || []).slice(0, 3),
        targets: (entry.targets || []).slice(0, 6),
        truncated: entry.truncated,
      })),
      rules: data?.rules,
      truncated: data?.truncated,
    };
  }

  if (toolName === 'get_land_production_audit') {
    return {
      auditedLandCount: data?.auditedLandCount,
      buildingMix: data?.buildingMix
        ? {
          accumulatedLifetimeHours: data.buildingMix.accumulatedLifetimeHours,
          accumulatedPts: data.buildingMix.accumulatedPts,
          builtBuildings: (data.buildingMix.builtBuildings || []).slice(0, 12),
          productionLifetimePerDayHours: data.buildingMix.productionLifetimePerDayHours,
          productionPtsPerDay: data.buildingMix.productionPtsPerDay,
        }
        : null,
      ownedLandCount: data?.ownedLandCount,
      topClaimable: (data?.topClaimable || []).slice(0, 8).map((land: UntypedValue) => ({
        id: land.id,
        name: land.name,
        storedLifetimeHours: land.storedLifetimeHours,
        storedPts: land.storedPts,
        topUnclaimedBuildings: (land.topUnclaimedBuildings || []).slice(0, 3),
        unclaimedLifetimeHours: land.unclaimedLifetimeHours,
        unclaimedPts: land.unclaimedPts,
      })),
      topProducers: (data?.topProducers || []).slice(0, 8).map((land: UntypedValue) => ({
        id: land.id,
        name: land.name,
        productionLifetimePerDayHours: land.productionLifetimePerDayHours,
        productionPtsPerDay: land.productionPtsPerDay,
      })),
      totals: data?.totals,
      truncated: data?.truncated,
    };
  }

  if (toolName === 'get_casino_status') {
    return {
      configs: data?.configs,
      featureFlags: data?.featureFlags,
      lands: (data?.lands || []).slice(0, 8).map((land: UntypedValue) => ({
        blackjack: land.blackjack,
        id: land.id,
        name: land.name,
        roulette: land.roulette,
      })),
      ownedLandCount: data?.ownedLandCount,
      scannedLandCount: data?.scannedLandCount,
      totalCasinoLandsInScan: data?.totalCasinoLandsInScan,
      truncated: data?.truncated,
    };
  }

  if (toolName === 'get_marketplace_orders') {
    return {
      active: data?.active,
      inactiveOrders: (data?.inactiveOrders || []).slice(0, 6),
      myOrders: data?.myOrders
        ? {
          active: (data.myOrders.active || []).slice(0, 6),
          inactive: (data.myOrders.inactive || []).slice(0, 4),
          total: data.myOrders.total,
        }
        : undefined,
      orderBook: {
        ...data?.orderBook,
        asks: (data?.orderBook?.asks || []).slice(0, 8),
        bids: (data?.orderBook?.bids || []).slice(0, 8),
      },
      rules: data?.rules,
      userCanUseMarketplaceUi: data?.userCanUseMarketplaceUi,
      userOwnedLandCount: data?.userOwnedLandCount,
      truncated: data?.truncated,
    };
  }

  if (toolName === 'get_claim_eligibility') {
    return {
      airdrop: data?.airdrop,
      ui: data?.ui,
      verifyFreePlant: data?.verifyFreePlant,
    };
  }

  if (toolName === 'get_app_status') {
    return {
      featureFlags: data?.featureFlags,
      overall: data?.overall,
      services: (data?.services || []).slice(0, 12),
      solanaBridgeConfig: data?.solanaBridgeConfig,
      statusGeneratedAt: data?.statusGeneratedAt,
    };
  }

  if (toolName === 'get_daily_task_plan') {
    return {
      mission: data?.mission,
      missionScore: data?.missionScore,
      readinessContext: data?.readinessContext,
      suggestedNext: (data?.suggestedNext || []).slice(0, 6),
      taskCounts: data?.taskCounts,
      streak: data?.streak,
      truncated: data?.truncated,
    };
  }

  if (toolName === 'get_known_allowances') {
    return {
      allowances: (data?.allowances || []).slice(0, 18).map((entry: UntypedValue) => ({
        allowanceDisplay: entry.allowanceDisplay,
        spender: entry.spender,
        spenderId: entry.spenderId,
        token: entry.token,
        tokenId: entry.tokenId,
        useCases: entry.useCases,
      })),
      errors: data?.errors,
      includeZeroAllowances: data?.includeZeroAllowances,
      knownOnly: data?.knownOnly,
      spenderCount: data?.spenderCount,
      tokenCount: data?.tokenCount,
    };
  }

  if (toolName === 'get_bridge_status') {
    return {
      baseAddress: data?.baseAddress,
      bridge: data?.bridge,
      twin: data?.twin,
      ui: data?.ui,
    };
  }

  if (toolName === 'get_lands') {
    return {
      buildingProductionTotals: data?.buildingProductionTotals,
      count: data?.count,
      lands: (data?.lands || []).slice(0, 6).map((land: UntypedValue) => ({
        barracks: land.barracks,
        buildings: land.buildings,
        id: land.id,
        name: land.name,
        quests: (land.quests || []).slice(0, 4),
        storedLifetimeHours: land.storedLifetimeHours,
        storedPts: land.storedPts,
      })),
      totalOwned: data?.totalOwned,
      truncated: data?.truncated,
      warehouseTotals: data?.warehouseTotals,
    };
  }

  if (toolName === 'get_game_action_guide') {
    return {
      actions: (data?.actions || []).slice(0, 12).map((action: UntypedValue) => ({
        canRead: action.canRead,
        cannotDo: action.cannotDo,
        deferralText: action.deferralText,
        id: action.id,
        liveDataSources: action.liveDataSources,
        stalenessRules: action.stalenessRules,
        title: action.title,
        userFlows: action.userFlows || action.userFlow,
        where: action.where,
      })),
      readOnlyPhase: data?.readOnlyPhase,
    };
  }

  if (toolName === 'get_token_info') {
    return {
      noFinancialAdvice: data?.noFinancialAdvice,
      tokens: (data?.tokens || []).map((token: UntypedValue) => ({
        contractAddress: token.contractAddress,
        id: token.id,
        name: token.name,
        noFinancialAdvice: token.noFinancialAdvice,
        note: token.note,
        sections: token.sections,
        summary: token.summary,
        symbol: token.symbol,
      })),
    };
  }

  if (toolName === 'get_seed_market_pulse') {
    const market = data?.market;
    return {
      market: market
        ? {
          cached: market.cached,
          dexId: market.dexId,
          fdv: market.fdv,
          liquidityUsd: market.liquidityUsd,
          marketCap: market.marketCap,
          pairAddress: market.pairAddress,
          pairCreatedAt: market.pairCreatedAt,
          priceChange: market.priceChange,
          priceNative: market.priceNative,
          priceUsd: market.priceUsd,
          rewards: market.rewards,
          stale: market.stale,
          timestamp: market.timestamp,
          txns: market.txns,
          volume: market.volume,
          volume24h: market.volume24h,
        }
        : null,
      noFinancialAdvice: data?.noFinancialAdvice,
      pairUrl: data?.pairUrl,
      poweredBy: data?.poweredBy,
    };
  }

  return sanitizeToolTraceValue(data ?? output);
}

function compactJson(value: UntypedValue, maxLength: number): string {
  return capString(JSON.stringify(value), maxLength);
}

function extractAIToolOutputSummaries(result: UntypedValue): UntypedValue[] {
  const rawToolResults: UntypedValue[] = [
    ...((result.steps || []).flatMap((step: UntypedValue) => step.toolResults || [])),
    ...(result.toolResults || []),
  ];

  return rawToolResults.map((toolResult) => {
    const output = toolResult.output ?? toolResult.result;
    const toolName = String(toolResult.toolName || 'unknown_tool');
    const compactOutput = compactToolPromptValue(toolName, output);
    return {
      input: sanitizeToolTraceValue(toolResult.input ?? toolResult.args),
      output: compactJson(compactOutput, AI_TOOL_CONTEXT_MAX_CHARS_PER_TOOL),
      toolName,
    };
  }).sort((a, b) => getToolPriority(a.toolName) - getToolPriority(b.toolName));
}

function buildToolContextText(result: UntypedValue): string {
  const summaries = extractAIToolOutputSummaries(result);
  return compactJson(summaries, AI_TOOL_CONTEXT_MAX_CHARS);
}

function isRecord(value: UntypedValue): value is Record<string, UntypedValue> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function truncateTraceString(value: string): string {
  return value.length > TOOL_TRACE_MAX_STRING_LENGTH
    ? `${value.slice(0, TOOL_TRACE_MAX_STRING_LENGTH)}...`
    : value;
}

function sanitizeToolTraceValue(value: UntypedValue, depth = 0): UntypedValue {
  if (depth > TOOL_TRACE_MAX_DEPTH) {
    return '[truncated]';
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return truncateTraceString(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, TOOL_TRACE_MAX_ARRAY_ITEMS)
      .map((entry) => sanitizeToolTraceValue(entry, depth + 1));
  }

  if (isRecord(value)) {
    const entries = Object.entries(value).slice(0, TOOL_TRACE_MAX_OBJECT_KEYS);
    const output: Record<string, UntypedValue> = {};

    for (const [key, nested] of entries) {
      output[key] = TRACE_SECRET_KEY_PATTERN.test(key)
        ? '[redacted]'
        : sanitizeToolTraceValue(nested, depth + 1);
    }

    return output;
  }

  return undefined;
}

function normalizeToolFreshness(output: UntypedValue): AIToolCallTrace['freshness'] | undefined {
  const freshness = output?.freshness;
  if (!isRecord(freshness)) {
    return undefined;
  }

  return {
    blockNumber: freshness.blockNumber === undefined ? undefined : String(freshness.blockNumber),
    cache: typeof freshness.cache === 'string' ? freshness.cache : undefined,
    fetchedAt: typeof freshness.fetchedAt === 'string' ? freshness.fetchedAt : undefined,
  };
}

function normalizeToolTrace(toolResult: UntypedValue): AIToolCallTrace | null {
  const toolName = typeof toolResult?.toolName === 'string' ? toolResult.toolName : undefined;
  if (!toolName) {
    return null;
  }

  const output = toolResult.output ?? toolResult.result;
  const status = output?.status === 'ok' || output?.status === 'error'
    ? output.status
    : (toolResult.error ? 'error' : 'unknown');
  const input = sanitizeToolTraceValue(toolResult.input ?? toolResult.args);
  const trace: AIToolCallTrace = {
    status,
    toolName,
  };

  if (typeof output?.source === 'string') {
    trace.source = output.source;
  }

  const freshness = normalizeToolFreshness(output);
  if (freshness) {
    trace.freshness = freshness;
  }

  if (input !== undefined) {
    trace.input = input;
  }

  if (output?.error || toolResult.error) {
    trace.error = truncateTraceString(String(output?.error || toolResult.error));
  }

  return trace;
}

export function extractAIToolTraces(result: UntypedValue): AIToolCallTrace[] {
  const rawToolResults: UntypedValue[] = [
    ...((result.steps || []).flatMap((step: UntypedValue) => step.toolResults || [])),
    ...(result.toolResults || []),
  ];
  const seen = new Set<string>();
  const traces: AIToolCallTrace[] = [];

  for (const toolResult of rawToolResults) {
    const trace = normalizeToolTrace(toolResult);
    if (!trace) {
      continue;
    }

    const dedupeKey = JSON.stringify({
      fetchedAt: trace.freshness?.fetchedAt,
      input: trace.input,
      status: trace.status,
      toolName: trace.toolName,
    });
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    traces.push(trace);
  }

  return traces;
}

function isAbortError(error: UntypedValue): boolean {
  return error?.name === 'AbortError' || /abort/i.test(String(error?.message || ''));
}

export function stripAIMessageDebugMetadata(message: AIChatMessage): AIChatMessage {
  if (!message.toolCalls?.length) {
    return message;
  }

  const publicMessage: AIChatMessage = {
    ...message,
    toolCalls: message.toolCalls.map((trace) => ({
      freshness: trace.freshness,
      source: trace.source,
      status: trace.status,
      toolName: trace.toolName,
    })),
  };
  return publicMessage;
}

// Validate AI message content
export function validateAIMessage(message: string): string | null {
  if (!message || typeof message !== 'string') {
    return 'Message is required';
  }

  const trimmed = message.trim();

  if (trimmed.length < MIN_AI_MESSAGE_LENGTH) {
    return 'Message is too short';
  }

  if (trimmed.length > MAX_AI_MESSAGE_LENGTH) {
    return `Message is too long (max ${MAX_AI_MESSAGE_LENGTH} characters)`;
  }

  return null;
}

// Check AI rate limit for a user
export async function checkAIRateLimit(address: string): Promise<boolean> {
  if (!redis) {
    console.warn('Redis unavailable - failing open for rate limit');
    return true; // Fail open
  }

  try {
    const rateLimitKey = `ai:ratelimit:${address.toLowerCase()}`;
    const lastMessage = await redis.get(rateLimitKey);

    if (!lastMessage) return true;

    // Validate that lastMessage is a valid timestamp
    if (typeof lastMessage !== 'string' && typeof lastMessage !== 'number') {
      console.warn('Invalid rate limit data type');
      return true; // Fail open
    }

    const now = Date.now();
    const lastMessageTime = parseInt(String(lastMessage), 10);
    if (isNaN(lastMessageTime)) {
      console.warn('Invalid rate limit timestamp');
      return true; // Fail open
    }

    return (now - lastMessageTime) >= (AI_RATE_LIMIT_WINDOW * 1000);
  } catch (error) {
    console.error('Rate limit check failed:', error);
    return true; // Fail open on error
  }
}

// Update AI rate limit for a user
export async function updateAIRateLimit(address: string): Promise<void> {
  if (!redis) {
    return; // Skip if Redis is not available
  }

  try {
    const rateLimitKey = `ai:ratelimit:${address.toLowerCase()}`;
    const now = Date.now();
    await redis.set(rateLimitKey, now.toString(), { ex: AI_RATE_LIMIT_TTL });
  } catch (error) {
    console.warn('Failed to update rate limit:', error);
  }
}

async function getTodayUserAIUsage(address: string): Promise<{ messages: number; tokens: number }> {
  if (!redis) return { messages: 0, tokens: 0 };

  const today = new Date().toISOString().split('T')[0];
  const usageKey = `ai:usage:${address.toLowerCase()}:${today}`;

  try {
    const currentUsage = await redis.get(usageKey);
    if (!currentUsage) return { messages: 0, tokens: 0 };
    const usage = typeof currentUsage === 'object' ? currentUsage : JSON.parse(currentUsage as string);

    return {
      messages: Number(usage.messages || 0),
      tokens: Number(usage.tokens || 0),
    };
  } catch (error) {
    console.warn('Failed to read AI usage budget:', error);
    return { messages: 0, tokens: 0 };
  }
}

export async function resolveAIRequestBudget(
  address: string,
  modelConfig: ReturnType<typeof getCurrentModelConfig>,
): Promise<AIRequestBudget> {
  const usage = await getTodayUserAIUsage(address);
  const remainingTokens = Math.max(MAX_AI_TOKENS_PER_DAY - usage.tokens, 0);
  const messageCapReached = MAX_AI_MESSAGES_PER_DAY > 0 && usage.messages >= MAX_AI_MESSAGES_PER_DAY;
  const tokenCapReached = usage.tokens >= MAX_AI_TOKENS_PER_DAY;

  if (messageCapReached || tokenCapReached) {
    return {
      autoContinueOnLength: false,
      continuationMaxOutputTokens: 0,
      hardStopReason: messageCapReached
        ? `Daily AI message limit reached (${MAX_AI_MESSAGES_PER_DAY}/day).`
        : 'Daily AI token limit reached.',
      maxOutputTokens: 0,
      mode: 'blocked',
      planningMaxOutputTokens: 0,
      remainingTokens,
      responseInstruction: '',
      usage,
    };
  }

  const softLimit = Math.floor(MAX_AI_TOKENS_PER_DAY * AI_SOFT_BUDGET_RATIO);
  const mode: AIRequestBudget['mode'] = usage.tokens >= softLimit ? 'soft' : 'normal';
  const answerCap = mode === 'soft'
    ? Math.min(modelConfig.maxTokens, AI_SOFT_BUDGET_MAX_OUTPUT_TOKENS)
    : modelConfig.maxTokens;
  const maxOutputTokens = Math.max(128, Math.min(answerCap, Math.max(128, remainingTokens)));
  const planningMaxOutputTokens = mode === 'soft'
    ? Math.min(AI_PLANNING_MAX_OUTPUT_TOKENS, 512)
    : AI_PLANNING_MAX_OUTPUT_TOKENS;
  const continuationMaxOutputTokens = mode === 'soft'
    ? Math.min(AI_CONTINUATION_MAX_OUTPUT_TOKENS, 768)
    : AI_CONTINUATION_MAX_OUTPUT_TOKENS;

  return {
    autoContinueOnLength: AI_AUTO_CONTINUE_ON_LENGTH,
    continuationMaxOutputTokens,
    maxOutputTokens,
    mode,
    planningMaxOutputTokens,
    remainingTokens,
    responseInstruction: mode === 'soft'
      ? 'Budget mode: answer in 120 words or fewer. Lead with the single safest next step, then one or two compact supporting bullets. Do not use tables.'
      : 'Answer style: lead with the direct recommendation first, then details. Use compact bullets. Do not use long tables unless the user explicitly asks for one.',
    usage,
  };
}

function buildBudgetFallbackMessage(reason?: string): string {
  return [
    reason || 'Daily AI budget is used for now.',
    '',
    'Here is the shortest useful next step: open **Farm** first and check whether any plant is dry, dying, dead, or under 10 hours of TOD. If you do not own a plant yet, open **Mint**, review the live price labels in the UI, and mint from there. I stay read-only, so the app UI must build and confirm every transaction.',
  ].join('\n');
}

// Get or create conversation for user
export async function getOrCreateConversation(address: string, firstMessage?: string): Promise<string> {
  if (!redis) {
    throw new Error('Redis client not available');
  }

  const lowerAddress = address.toLowerCase();
  const activeConversationKey = `ai:user_active_conversation:${lowerAddress}`;

  try {
    // Try to get active conversation ID from index
    const activeId = await redis.get(activeConversationKey);
    if (activeId && typeof activeId === 'string') {
      return activeId;
    }

    // Fallback: check legacy keys pattern if no index found
    // This provides backward compatibility during migration
    const conversationKeys = await redisScanKeysRaw(`ai:conversations:${lowerAddress}:*`);
    if (conversationKeys.length > 0) {
      const legacyId = conversationKeys[0].split(':')[3];
      // Index it for next time
      await redis.set(activeConversationKey, legacyId, { ex: AI_MESSAGE_TTL });
      await redis.sadd('ai:conversations:index', conversationKeys[0]);
      return legacyId;
    }
  } catch (error) {
    console.warn('Error checking existing conversations:', error);
  }

  // Create new conversation
  const conversationId = nanoid();
  const now = Date.now();

  const conversation: AIConversation = {
    id: conversationId,
    address: lowerAddress,
    title: firstMessage ? generateConversationTitle(firstMessage) : 'New Conversation',
    createdAt: now,
    lastMessageAt: now,
    messageCount: 0,
    model: getCurrentModelConfig().model,
    totalTokens: 0,
  };

  const conversationKey = `ai:conversations:${lowerAddress}:${conversationId}`;

  try {
    // Use pipeline for atomic updates
    const pipeline = redis.pipeline();
    pipeline.set(conversationKey, JSON.stringify(conversation), { ex: AI_MESSAGE_TTL });
    pipeline.set(activeConversationKey, conversationId, { ex: AI_MESSAGE_TTL });
    pipeline.sadd('ai:conversations:index', conversationKey);
    await pipeline.exec();
  } catch (error) {
    console.error('Error creating conversation:', error);
    throw error;
  }

  return conversationId;
}

// Store AI chat message
export async function storeAIMessage(
  address: string,
  message: string,
  type: 'user' | 'assistant',
  conversationId: string,
  tokensUsed: number = 0,
  options: StoreAIMessageOptions = {},
): Promise<AIChatMessage> {
  if (!redis) {
    throw new Error('Redis client not available');
  }

  const messageId = options.messageId || nanoid();
  const timestamp = Date.now();
  const lowerAddress = address.toLowerCase();

  const aiMessage: AIChatMessage = {
    id: messageId,
    conversationId,
    address: lowerAddress,
    continuations: options.continuations,
    message: message.trim(),
    timestamp,
    type,
    model: getCurrentModelConfig().model,
    tokensUsed,
    finishReason: options.finishReason,
    outputTokens: options.outputTokens,
    provider: options.provider || getCurrentAIProvider(),
    recoveredFromLength: options.recoveredFromLength,
    displayName: type === 'assistant' ? 'Neural Seed' : formatDisplayName(address)
  };

  if (type === 'assistant' && options.toolCalls?.length) {
    aiMessage.toolCalls = options.toolCalls;
  }

  const messageKey = `ai:messages:${conversationId}:${timestamp}:${messageId}`;
  const conversationKey = `ai:conversations:${lowerAddress}:${conversationId}`;
  const listKey = `ai:conversation_messages:${conversationId}`;

  try {
    const pipeline = redis.pipeline();

    // 1. Store message object
    pipeline.set(messageKey, JSON.stringify(aiMessage), { ex: AI_MESSAGE_TTL });

    // 2. Add key to ordered list (replaces KEYS scan)
    pipeline.rpush(listKey, messageKey);
    pipeline.expire(listKey, AI_MESSAGE_TTL);

    // 3. Update conversation metadata
    const conversationData = await redis.get(conversationKey);

    if (conversationData) {
      let conversation: AIConversation;
      if (typeof conversationData === 'object') {
        conversation = conversationData as AIConversation;
      } else {
        conversation = JSON.parse(conversationData as string);
      }

      conversation.lastMessageAt = timestamp;
      conversation.messageCount += 1;
      conversation.totalTokens += tokensUsed;

      pipeline.set(conversationKey, JSON.stringify(conversation), { ex: AI_MESSAGE_TTL });
    }

    await pipeline.exec();
  } catch (error) {
    console.error('Error storing AI message:', error);
    throw error;
  }

  return aiMessage;
}

// Get conversation messages
export async function getAIConversationMessages(conversationId: string, limit: number = 50): Promise<AIChatMessage[]> {
  if (!redis) {
    return [];
  }

  try {
    const listKey = `ai:conversation_messages:${conversationId}`;

    // 1. Try to get from new List structure first
    let messageKeys = await redis.lrange(listKey, -limit, -1);

    // 2. Fallback to KEYS if List is empty (migration path)
    if (messageKeys.length === 0) {
      const legacyKeys = await redisScanKeysRaw(`ai:messages:${conversationId}:*`);
      if (legacyKeys.length > 0) {
        // Sort keys by timestamp (ascending)
        legacyKeys.sort((a, b) => {
          const timestampA = parseInt(a.split(':')[3] || '0');
          const timestampB = parseInt(b.split(':')[3] || '0');
          return timestampA - timestampB;
        });
        messageKeys = legacyKeys.slice(-limit);

        // Optional: Backfill list for future speed
        if (messageKeys.length > 0) {
          await redis.rpush(listKey, ...messageKeys);
          await redis.expire(listKey, AI_MESSAGE_TTL);
        }
      }
    }

    if (messageKeys.length === 0) return [];

    // 3. Fetch all message data in one batch
    const dataArray = await redis.mget(...messageKeys);

    const messages: AIChatMessage[] = [];
    for (const data of dataArray) {
      if (data) {
        try {
          const message = typeof data === 'object' ? data : JSON.parse(data as string);
          messages.push(message as AIChatMessage);
        } catch {
          // Ignore malformed messages
        }
      }
    }

    return messages;
  } catch (error) {
    console.error('Error fetching AI messages:', error);
    return [];
  }
}

export async function getAIConversationForAddress(
  address: string,
  conversationId: string,
): Promise<AIConversation | null> {
  if (!redis) {
    return null;
  }

  const conversationKey = `ai:conversations:${address.toLowerCase()}:${conversationId}`;

  try {
    const data = await redis.get(conversationKey);
    if (!data) {
      return null;
    }

    if (typeof data === 'object') {
      return data as AIConversation;
    }

    return JSON.parse(data as string) as AIConversation;
  } catch (error) {
    console.error('Error fetching AI conversation metadata:', error);
    return null;
  }
}

async function resolveConversationId(
  address: string,
  firstMessage?: string,
  requestedConversationId?: string | null,
): Promise<string> {
  if (requestedConversationId) {
    const existing = await getAIConversationForAddress(address, requestedConversationId);
    if (existing) {
      return requestedConversationId;
    }
  }

  return getOrCreateConversation(address, firstMessage);
}

function buildPlainModelMessages(historyMessages: AIChatMessage[], currentMessage: string): UntypedValue[] {
  return [
    ...historyMessages
      .filter((msg) => msg.message.trim())
      .map((msg) => ({
        content: msg.message,
        role: msg.type === 'user' ? 'user' : 'assistant',
      })),
    {
      content: currentMessage,
      role: 'user',
    },
  ];
}

async function buildGemini3SingleRoundToolContext(options: {
  abortSignal?: AbortSignal;
  address: string;
  currentMessage: string;
  historyMessages: AIChatMessage[];
  modelConfig: ReturnType<typeof getCurrentModelConfig>;
  requestBudget: AIRequestBudget;
  tools: UntypedValue;
}) {
  const planningResult = await generateText({
    abortSignal: options.abortSignal,
    maxOutputTokens: Math.min(options.modelConfig.maxTokens, options.requestBudget.planningMaxOutputTokens),
    messages: buildPlainModelMessages(options.historyMessages, options.currentMessage),
    model: getSDKModel(),
    providerOptions: getAIProviderOptions(options.address),
    stopWhen: stepCountIs(1),
    system: `${READ_ONLY_AGENT_SYSTEM_PROMPT}\n\n${options.requestBudget.responseInstruction}\n\nFor this tool-planning pass, call every needed read-only tool in a single round. Do not make sequential follow-up tool calls. Do not answer the user unless no tool is needed.`,
    timeout: {
      stepMs: AI_STEP_TIMEOUT_MS,
      totalMs: AI_REQUEST_TIMEOUT_MS,
    },
    tools: options.tools,
  });

  const usage = planningResult.totalUsage || planningResult.usage;
  const toolContextText = buildToolContextText(planningResult);
  const toolCalls = extractAIToolTraces(planningResult);

  return {
    finishReason: planningResult.finishReason,
    messages: [
      ...buildPlainModelMessages(options.historyMessages, options.currentMessage),
      {
        content: [
          'Compact sanitized read-only Pixotchi tool results for the current request:',
          toolContextText,
          `${options.requestBudget.responseInstruction} Quote priceDisplay exactly. Stay read-only and concise.`,
        ].join('\n\n'),
        role: 'user',
      },
    ],
    outputTokens: getOutputTokenCount(usage),
    reasoningTokens: getReasoningTokenCount(usage),
    tokensUsed: getTokenCount(usage),
    toolContextText,
    toolCalls,
  };
}

function getTokenCount(usage: UntypedValue): number {
  return Number(usage?.totalTokens ?? 0) ||
    ((Number(usage?.inputTokens || 0) || 0) + (Number(usage?.outputTokens || 0) || 0));
}

function getOutputTokenCount(usage: UntypedValue): number {
  return Number(usage?.outputTokens || 0) || 0;
}

function getReasoningTokenCount(usage: UntypedValue): number {
  return Number(usage?.reasoningTokens || usage?.outputTokenDetails?.reasoningTokens || usage?.raw?.thoughtsTokenCount || 0) || 0;
}

function applyFinishReasonNotice(text: string, finishReason: string | undefined): string {
  if (finishReason !== 'length') {
    return text;
  }

  if (text.includes(TRUNCATED_RESPONSE_NOTICE)) {
    return text;
  }

  return `${text.trim()}\n\n${TRUNCATED_RESPONSE_NOTICE}`;
}

function buildResponseSystemPrompt(requestBudget: AIRequestBudget): string {
  return `${READ_ONLY_AGENT_SYSTEM_PROMPT}\n\n${requestBudget.responseInstruction}`;
}

function getShortestUsefulNextStep(): string {
  return 'Here is the shortest useful next step: open **Farm** and care for urgent plants first. If you do not own a plant, open **Mint**, review the live price labels in the UI, and mint from there. I stay read-only; every transaction must be built and confirmed by the app UI.';
}

function buildContinuationMessages(options: {
  currentMessage: string;
  historyMessages: AIChatMessage[];
  partialResponse: string;
  toolContextText: string;
}): UntypedValue[] {
  return [
    ...buildPlainModelMessages(options.historyMessages, options.currentMessage),
    {
      content: [
        'Compact sanitized read-only Pixotchi tool results already used for this answer:',
        options.toolContextText || '[]',
      ].join('\n\n'),
      role: 'user',
    },
    {
      content: options.partialResponse,
      role: 'assistant',
    },
    {
      content: [
        'Continue the previous answer from exactly where it stopped.',
        'Do not repeat earlier sentences.',
        'Do not call tools.',
        'End with the single safest next in-app step for the player.',
      ].join(' '),
      role: 'user',
    },
  ];
}

async function generateLengthContinuation(options: {
  abortSignal?: AbortSignal;
  address: string;
  currentMessage: string;
  historyMessages: AIChatMessage[];
  partialResponse: string;
  requestBudget: AIRequestBudget;
  toolContextText: string;
}) {
  const result = await generateText({
    abortSignal: options.abortSignal,
    maxOutputTokens: options.requestBudget.continuationMaxOutputTokens,
    messages: buildContinuationMessages({
      currentMessage: options.currentMessage,
      historyMessages: options.historyMessages,
      partialResponse: options.partialResponse,
      toolContextText: options.toolContextText,
    }),
    model: getSDKModel(),
    providerOptions: getAIProviderOptions(options.address),
    stopWhen: stepCountIs(1),
    system: buildResponseSystemPrompt(options.requestBudget),
    timeout: {
      stepMs: AI_STEP_TIMEOUT_MS,
      totalMs: AI_REQUEST_TIMEOUT_MS,
    },
    ...getModelRequestSettings(),
  });
  const usage = result.totalUsage || result.usage;

  return {
    finishReason: result.finishReason,
    outputTokens: getOutputTokenCount(usage),
    reasoningTokens: getReasoningTokenCount(usage),
    text: result.text,
    tokensUsed: getTokenCount(usage),
  };
}

function getTextFromUIMessage(message: PixotchiAIUIMessage): string {
  return message.parts
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function buildAIMessageMetadata(options: {
  continuations?: number;
  conversationId: string;
  finishReason?: string;
  messageId: string;
  model: string;
  provider: string;
  recoveredFromLength?: boolean;
  tokensUsed?: number;
  toolCalls?: AIToolCallTrace[];
}): PixotchiAIMessageMetadata {
  return {
    continuations: options.continuations,
    conversationId: options.conversationId,
    finishReason: options.finishReason,
    model: options.model,
    persistedMessageId: options.messageId,
    provider: options.provider,
    recoveredFromLength: options.recoveredFromLength,
    tokensUsed: options.tokensUsed,
    toolCalls: options.toolCalls?.length ? options.toolCalls : undefined,
  };
}

function createStaticAIMessageResponse(
  aiResponse: AIChatMessage,
  options: {
    finishReason?: string;
    originalMessages?: PixotchiAIUIMessage[];
    provider: string;
  },
): Response {
  const metadata = buildAIMessageMetadata({
    continuations: aiResponse.continuations,
    conversationId: aiResponse.conversationId,
    finishReason: options.finishReason || aiResponse.finishReason || 'stop',
    messageId: aiResponse.id,
    model: aiResponse.model,
    provider: options.provider,
    recoveredFromLength: aiResponse.recoveredFromLength,
    tokensUsed: aiResponse.tokensUsed,
    toolCalls: aiResponse.toolCalls,
  });
  const textPartId = `text-${aiResponse.id}`;
  const stream = createUIMessageStream<PixotchiAIUIMessage>({
    originalMessages: options.originalMessages,
    execute: ({ writer }) => {
      writer.write({
        messageId: aiResponse.id,
        messageMetadata: metadata,
        type: 'start',
      });
      writer.write({ id: textPartId, type: 'text-start' });
      writer.write({ delta: aiResponse.message, id: textPartId, type: 'text-delta' });
      writer.write({ id: textPartId, type: 'text-end' });
      writer.write({
        finishReason: (options.finishReason || aiResponse.finishReason || 'stop') as FinishReason,
        messageMetadata: metadata,
        type: 'finish',
      });
    },
  });

  return createUIMessageStreamResponse({
    headers: {
      'Cache-Control': 'private, no-store',
    },
    stream,
  });
}

function normalizeAIProviderError(error: UntypedValue): string {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  const message = String(error?.message || '');

  if (statusCode === 401 || statusCode === 403 || /auth|api key|credential/i.test(message)) {
    return 'AI is not configured correctly right now. Please try again later.';
  }

  if (statusCode === 429 || /rate limit|quota/i.test(message)) {
    return 'AI is temporarily rate limited. Please try again in a little while.';
  }

  if (/timeout|timed out/i.test(message)) {
    return 'AI took too long to answer. Please try a shorter question.';
  }

  return 'Sorry, I encountered an error while processing your request. Please try again later.';
}

export async function streamAIMessage(
  address: string,
  message: string,
  options: StreamAIMessageOptions = {},
): Promise<Response> {
  const conversationId = await resolveConversationId(address, message, options.conversationId);
  const historyMessages = await getAIConversationMessages(conversationId, 10);
  await storeAIMessage(address, message, 'user', conversationId);

  const provider = getCurrentAIProvider();
  const modelConfig = getCurrentModelConfig();

  const safety = classifyAIUserMessage(message);
  if (!safety.allowed) {
    console.warn('AI request blocked by safety gate:', {
      address: address.slice(0, 6) + '...',
      reason: safety.reason,
    });

    const aiResponse = await storeAIMessage(
      address,
      safety.response,
      'assistant',
      conversationId,
      0,
      {
        finishReason: 'stop',
        provider,
      },
    );

    return createStaticAIMessageResponse(aiResponse, {
      finishReason: 'stop',
      originalMessages: options.originalMessages,
      provider,
    });
  }

  const requestBudget = await resolveAIRequestBudget(address, modelConfig);
  if (requestBudget.mode === 'blocked') {
    const aiResponse = await storeAIMessage(
      address,
      buildBudgetFallbackMessage(requestBudget.hardStopReason),
      'assistant',
      conversationId,
      0,
      {
        finishReason: 'stop',
        provider,
      },
    );

    return createStaticAIMessageResponse(aiResponse, {
      finishReason: 'stop',
      originalMessages: options.originalMessages,
      provider,
    });
  }

  const configValidation = validateAIConfig();
  if (!configValidation.valid) {
    throw new Error(`AI configuration error: ${configValidation.errors.join(', ')}`);
  }

  console.log('AI stream prompt info:', {
    hasHistory: historyMessages.length > 0,
    messageLength: message.length,
    model: modelConfig.model,
    provider,
  });

  const responseMessageId = nanoid();
  const tools = createReadOnlyAITools({ sourceAddress: options.sourceAddress, userAddress: address });
  let finishReason: string | undefined;
  let finalFinishReason: string | undefined;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let tokensUsed = 0;
  let toolCalls: AIToolCallTrace[] = [];
  let generationMessages = buildPlainModelMessages(historyMessages, message);
  let generationTools: UntypedValue = tools;
  let preflightOutputTokens = 0;
  let preflightReasoningTokens = 0;
  let preflightTokensUsed = 0;
  let preflightToolContextText = '';
  let preflightToolCalls: AIToolCallTrace[] = [];
  let continuations = 0;
  let recoveredFromLength = false;
  let toolContextText = '';

  if (isDirectGoogleGemini3Model()) {
    const planning = await buildGemini3SingleRoundToolContext({
      abortSignal: options.abortSignal,
      address,
      currentMessage: message,
      historyMessages,
      modelConfig,
      requestBudget,
      tools,
    });

    generationMessages = planning.messages;
    generationTools = undefined;
    preflightOutputTokens = planning.outputTokens;
    preflightReasoningTokens = planning.reasoningTokens || 0;
    preflightTokensUsed = planning.tokensUsed;
    preflightToolContextText = planning.toolContextText;
    preflightToolCalls = planning.toolCalls;
  }

  const result = streamText({
    abortSignal: options.abortSignal,
    maxOutputTokens: requestBudget.maxOutputTokens,
    messages: generationMessages,
    model: getSDKModel(),
    onFinish: (event) => {
      const usage = event.totalUsage || event.usage;
      finishReason = event.finishReason;
      finalFinishReason = event.finishReason;
      tokensUsed = preflightTokensUsed + getTokenCount(usage);
      outputTokens = preflightOutputTokens + getOutputTokenCount(usage);
      reasoningTokens = preflightReasoningTokens + getReasoningTokenCount(usage);
      toolCalls = preflightToolCalls.length ? preflightToolCalls : extractAIToolTraces(event);
      toolContextText = preflightToolContextText || buildToolContextText(event);

      if (event.finishReason === 'length') {
        console.warn('[AI_LENGTH_FINISH]', {
          address: address.slice(0, 6) + '...',
          autoContinueOnLength: requestBudget.autoContinueOnLength,
          budgetMode: requestBudget.mode,
          maxOutputTokens: requestBudget.maxOutputTokens,
          model: modelConfig.model,
          outputTokens,
          provider,
        });
      }
    },
    providerOptions: getAIProviderOptions(address),
    stopWhen: stepCountIs(8),
    system: buildResponseSystemPrompt(requestBudget),
    timeout: {
      stepMs: AI_STEP_TIMEOUT_MS,
      totalMs: AI_REQUEST_TIMEOUT_MS,
    },
    ...(generationTools ? { tools: generationTools } : {}),
    ...getModelRequestSettings(),
  });

  const stream = createUIMessageStream<PixotchiAIUIMessage>({
    originalMessages: options.originalMessages,
    execute: async ({ writer }) => {
      let streamedResponseText = '';
      writer.write({
        messageId: responseMessageId,
        messageMetadata: buildAIMessageMetadata({
          conversationId,
          messageId: responseMessageId,
          model: modelConfig.model,
          provider,
        }),
        type: 'start',
      });

      for await (const chunk of result.toUIMessageStream<PixotchiAIUIMessage>({
        sendFinish: false,
        sendReasoning: false,
        sendStart: false,
      })) {
        if (chunk.type === 'text-delta' && typeof chunk.delta === 'string') {
          streamedResponseText += chunk.delta;
        }
        writer.write(chunk);
      }

      if (finishReason === 'length' && streamedResponseText.trim()) {
        if (requestBudget.autoContinueOnLength && requestBudget.continuationMaxOutputTokens > 0) {
          try {
            const continuation = await generateLengthContinuation({
              abortSignal: options.abortSignal,
              address,
              currentMessage: message,
              historyMessages,
              partialResponse: streamedResponseText,
              requestBudget,
              toolContextText,
            });
            continuations = 1;
            tokensUsed += continuation.tokensUsed;
            outputTokens += continuation.outputTokens;
            reasoningTokens += continuation.reasoningTokens;
            finalFinishReason = continuation.finishReason;
            recoveredFromLength = continuation.finishReason !== 'length' && continuation.text.trim().length > 0;

            if (continuation.text.trim()) {
              const continuationPartId = `continuation-${responseMessageId}`;
              writer.write({ id: continuationPartId, type: 'text-start' });
              writer.write({ delta: `\n\n${continuation.text.trim()}`, id: continuationPartId, type: 'text-delta' });
              writer.write({ id: continuationPartId, type: 'text-end' });
            }

            if (continuation.finishReason === 'length') {
              const fallbackPartId = `length-fallback-${responseMessageId}`;
              writer.write({ id: fallbackPartId, type: 'text-start' });
              writer.write({ delta: `\n\n${getShortestUsefulNextStep()}`, id: fallbackPartId, type: 'text-delta' });
              writer.write({ id: fallbackPartId, type: 'text-end' });
            }

            console.warn('[AI_LENGTH_RECOVERY]', {
              address: address.slice(0, 6) + '...',
              finalFinishReason,
              model: modelConfig.model,
              recoveredFromLength,
              provider,
            });
          } catch (error) {
            finalFinishReason = 'length';
            const fallbackPartId = `length-fallback-${responseMessageId}`;
            writer.write({ id: fallbackPartId, type: 'text-start' });
            writer.write({ delta: `\n\n${getShortestUsefulNextStep()}`, id: fallbackPartId, type: 'text-delta' });
            writer.write({ id: fallbackPartId, type: 'text-end' });
            console.warn('[AI_LENGTH_RECOVERY_FAILED]', {
              address: address.slice(0, 6) + '...',
              error: error instanceof Error ? error.message : String(error),
              model: modelConfig.model,
              provider,
            });
          }
        } else {
          const noticePartId = `length-notice-${responseMessageId}`;
          writer.write({ id: noticePartId, type: 'text-start' });
          writer.write({ delta: `\n\n${TRUNCATED_RESPONSE_NOTICE}`, id: noticePartId, type: 'text-delta' });
          writer.write({ id: noticePartId, type: 'text-end' });
        }
      }

      writer.write({
        finishReason: finalFinishReason as FinishReason | undefined,
        messageMetadata: buildAIMessageMetadata({
          continuations,
          conversationId,
          finishReason: finalFinishReason,
          messageId: responseMessageId,
          model: modelConfig.model,
          provider,
          recoveredFromLength,
          tokensUsed,
          toolCalls,
        }),
        type: 'finish',
      });
    },
    onError: (error) => {
      console.error('AI stream error:', {
        address: address.slice(0, 6) + '...',
        error: error instanceof Error ? error.message : String(error),
        model: modelConfig.model,
        provider,
      });
      return normalizeAIProviderError(error);
    },
    onFinish: async ({ isAborted, responseMessage }) => {
      if (isAborted) {
        console.warn('AI stream aborted before completion:', {
          address: address.slice(0, 6) + '...',
          model: modelConfig.model,
          provider,
        });
        return;
      }

      const responseText = getTextFromUIMessage(responseMessage);

      if (!responseText.trim()) {
        return;
      }

      await storeAIMessage(
        address,
        responseText,
        'assistant',
        conversationId,
        tokensUsed,
        {
          continuations,
          finishReason: finalFinishReason,
          messageId: responseMessageId,
          outputTokens,
          provider,
          recoveredFromLength,
          toolCalls,
        },
      );

      await trackAIUsage(address, tokensUsed, {
        continuations,
        finishReason: finalFinishReason,
        inputTokens: Math.max(tokensUsed - outputTokens, 0),
        lengthFinishes: finishReason === 'length' ? 1 : 0,
        model: modelConfig.model,
        outputTokens,
        provider,
        reasoningTokens,
        recoveredFromLength,
      });
    },
  });

  return createUIMessageStreamResponse({
    headers: {
      'Cache-Control': 'private, no-store',
    },
    stream,
  });
}

// Send message to AI and get response
export async function sendAIMessage(address: string, message: string, options: SendAIMessageOptions = {}): Promise<{
  userMessage: AIChatMessage;
  aiResponse: AIChatMessage;
}> {
  const conversationId = await resolveConversationId(address, message);

  // Get conversation history for context
  const historyMessages = await getAIConversationMessages(conversationId, 10);
  // History is now mapped directly to the messages array later

  // Store user message
  const userMessage = await storeAIMessage(address, message, 'user', conversationId);

  const safety = classifyAIUserMessage(message);
  if (!safety.allowed) {
    console.warn('AI request blocked by safety gate:', {
      address: address.slice(0, 6) + '...',
      reason: safety.reason,
    });

    const aiResponse = await storeAIMessage(
      address,
      safety.response,
      'assistant',
      conversationId,
    );

    return { userMessage, aiResponse };
  }

  const modelConfig = getCurrentModelConfig();
  const requestBudget = await resolveAIRequestBudget(address, modelConfig);
  if (requestBudget.mode === 'blocked') {
    const aiResponse = await storeAIMessage(
      address,
      buildBudgetFallbackMessage(requestBudget.hardStopReason),
      'assistant',
      conversationId,
    );

    return { userMessage, aiResponse };
  }

  try {
    const configValidation = validateAIConfig();
    if (!configValidation.valid) {
      throw new Error(`AI configuration error: ${configValidation.errors.join(', ')}`);
    }

    console.log('📝 AI Prompt Info:', {
      messageLength: message.length,
      hasHistory: historyMessages.length > 0,
      provider: getCurrentAIProvider(),
      model: modelConfig.model,
    });

    const tools = createReadOnlyAITools({ sourceAddress: options.sourceAddress, userAddress: address });
    let generationMessages = buildPlainModelMessages(historyMessages, message);
    let generationTools: UntypedValue = tools;
    let preflightOutputTokens = 0;
    let preflightReasoningTokens = 0;
    let preflightTokensUsed = 0;
    let preflightToolContextText = '';
    let preflightToolCalls: AIToolCallTrace[] = [];

    if (isDirectGoogleGemini3Model()) {
      const planning = await buildGemini3SingleRoundToolContext({
        abortSignal: options.abortSignal,
        address,
        currentMessage: message,
        historyMessages,
        modelConfig,
        requestBudget,
        tools,
      });

      generationMessages = planning.messages;
      generationTools = undefined;
      preflightOutputTokens = planning.outputTokens;
      preflightReasoningTokens = planning.reasoningTokens || 0;
      preflightTokensUsed = planning.tokensUsed;
      preflightToolContextText = planning.toolContextText;
      preflightToolCalls = planning.toolCalls;
    }

    // Use Vercel AI SDK generateText with messages array
    const result = await generateText({
      abortSignal: options.abortSignal,
      maxOutputTokens: requestBudget.maxOutputTokens,
      model: getSDKModel(),
      messages: generationMessages,
      providerOptions: getAIProviderOptions(address),
      stopWhen: stepCountIs(8),
      system: buildResponseSystemPrompt(requestBudget),
      timeout: {
        stepMs: AI_STEP_TIMEOUT_MS,
        totalMs: AI_REQUEST_TIMEOUT_MS,
      },
      ...(generationTools ? { tools: generationTools } : {}),
      ...getModelRequestSettings(),
    });

    const usage = result.totalUsage || result.usage;
    let response = result.text;
    let finalFinishReason = result.finishReason;
    let tokensUsed = preflightTokensUsed + getTokenCount(usage);
    let outputTokens = preflightOutputTokens + getOutputTokenCount(usage);
    let reasoningTokens = preflightReasoningTokens + getReasoningTokenCount(usage);
    let continuations = 0;
    let recoveredFromLength = false;
    const toolCalls = preflightToolCalls.length ? preflightToolCalls : extractAIToolTraces(result);
    const toolContextText = preflightToolContextText || buildToolContextText(result);

    if (result.finishReason === 'length') {
      console.warn('[AI_LENGTH_FINISH]', {
        address: address.slice(0, 6) + '...',
        autoContinueOnLength: requestBudget.autoContinueOnLength,
        budgetMode: requestBudget.mode,
        maxOutputTokens: requestBudget.maxOutputTokens,
        model: modelConfig.model,
        outputTokens,
        provider: getCurrentAIProvider(),
      });

      if (requestBudget.autoContinueOnLength && response.trim()) {
        try {
          const continuation = await generateLengthContinuation({
            abortSignal: options.abortSignal,
            address,
            currentMessage: message,
            historyMessages,
            partialResponse: response,
            requestBudget,
            toolContextText,
          });
          continuations = 1;
          tokensUsed += continuation.tokensUsed;
          outputTokens += continuation.outputTokens;
          reasoningTokens += continuation.reasoningTokens;
          finalFinishReason = continuation.finishReason;
          recoveredFromLength = continuation.finishReason !== 'length' && continuation.text.trim().length > 0;
          if (continuation.text.trim()) {
            response = `${response.trim()}\n\n${continuation.text.trim()}`;
          }
          if (continuation.finishReason === 'length') {
            response = `${response.trim()}\n\n${getShortestUsefulNextStep()}`;
          }
          console.warn('[AI_LENGTH_RECOVERY]', {
            address: address.slice(0, 6) + '...',
            finalFinishReason,
            model: modelConfig.model,
            recoveredFromLength,
            provider: getCurrentAIProvider(),
          });
        } catch (error) {
          finalFinishReason = 'length';
          response = `${response.trim()}\n\n${getShortestUsefulNextStep()}`;
          console.warn('[AI_LENGTH_RECOVERY_FAILED]', {
            address: address.slice(0, 6) + '...',
            error: error instanceof Error ? error.message : String(error),
            model: modelConfig.model,
            provider: getCurrentAIProvider(),
          });
        }
      } else {
        response = applyFinishReasonNotice(response, result.finishReason);
      }
    }

    console.log('✅ AI Response Received:', {
      responseLength: response.length,
      tokensUsed,
      toolCalls,
      responsePreview: response.substring(0, 100) + (response.length > 100 ? '...' : ''),
    });

    // Store AI response
    const aiResponse = await storeAIMessage(
      address,
      response,
      'assistant',
      conversationId,
      tokensUsed,
      {
        continuations,
        finishReason: finalFinishReason,
        outputTokens,
        provider: getCurrentAIProvider(),
        recoveredFromLength,
        toolCalls,
      },
    );

    // Track usage
    await trackAIUsage(address, tokensUsed, {
      continuations,
      finishReason: finalFinishReason,
      inputTokens: Math.max(tokensUsed - outputTokens, 0),
      lengthFinishes: result.finishReason === 'length' ? 1 : 0,
      model: modelConfig.model,
      outputTokens,
      provider: getCurrentAIProvider(),
      reasoningTokens,
      recoveredFromLength,
    });

    return { userMessage, aiResponse };
  } catch (error) {
    if (isAbortError(error)) {
      console.warn('AI request stopped before completion:', {
        address: address.slice(0, 6) + '...',
        model: getCurrentModelConfig().model,
        provider: getCurrentAIProvider(),
      });
      throw error;
    }

    console.error('AI Provider Error:', {
      provider: getCurrentAIProvider(),
      model: getCurrentModelConfig().model,
      error: error instanceof Error ? error.message : String(error),
      address: address.slice(0, 6) + '...'
    });

    // Store error response
    const errorResponse = await storeAIMessage(
      address,
      normalizeAIProviderError(error),
      'assistant',
      conversationId
    );

    return { userMessage, aiResponse: errorResponse };
  }
}

// Track AI usage
export async function trackAIUsage(
  address: string,
  tokensUsed: number,
  options: AIUsageTrackingOptions = {},
): Promise<void> {
  if (!redis) return;

  const today = new Date().toISOString().split('T')[0];
  const usageKey = `ai:usage:${address.toLowerCase()}:${today}`;
  const dateIndexKey = `ai:usage_index:${today}`;

  try {
    const pipeline = redis.pipeline();

    // 1. Get current usage
    const currentUsage = await redis.get(usageKey);
    let totalTokens = tokensUsed;
    let totalMessages = 1;
    let inputTokens = options.inputTokens || 0;
    let outputTokens = options.outputTokens || 0;
    let reasoningTokens = options.reasoningTokens || 0;
    let continuations = options.continuations || 0;
    let lengthFinishes = options.lengthFinishes || 0;
    let recoveredFromLengthCount = options.recoveredFromLength ? 1 : 0;
    let finishReasons: Record<string, number> = {};

    if (currentUsage) {
      const usage = typeof currentUsage === 'object' ? currentUsage : JSON.parse(currentUsage as string);
      totalTokens += usage.tokens || 0;
      totalMessages += usage.messages || 0;
      inputTokens += usage.inputTokens || 0;
      outputTokens += usage.outputTokens || 0;
      reasoningTokens += usage.reasoningTokens || 0;
      continuations += usage.continuations || 0;
      lengthFinishes += usage.lengthFinishes || 0;
      recoveredFromLengthCount += usage.recoveredFromLengthCount || 0;
      finishReasons = usage.finishReasons || {};
    }

    if (options.finishReason) {
      finishReasons[options.finishReason] = (finishReasons[options.finishReason] || 0) + 1;
    }

    // 2. Update usage
    pipeline.set(usageKey, JSON.stringify({
      date: today,
      finishReasons,
      inputTokens,
      messages: totalMessages,
      model: options.model,
      outputTokens,
      provider: options.provider,
      reasoningTokens,
      continuations,
      lengthFinishes,
      recoveredFromLengthCount,
      tokens: totalTokens,
    }), { ex: AI_USAGE_TTL });

    // 3. Add to date index (avoids KEYS * scan for usage stats)
    pipeline.sadd(dateIndexKey, usageKey);
    pipeline.expire(dateIndexKey, AI_USAGE_TTL);

    await pipeline.exec();
  } catch (error) {
    console.error('Error tracking AI usage:', error);
  }
}

// Admin functions
export async function getAllAIConversations(): Promise<AIConversation[]> {
  if (!redis) return [];

  try {
    // Use Set index instead of KEYS *
    let conversationKeys = await redis.smembers('ai:conversations:index');

    // Fallback to KEYS for migration if index empty
    if (conversationKeys.length === 0) {
      conversationKeys = await redisScanKeysRaw('ai:conversations:*');
      // Filter out non-conversation keys (like indices)
      conversationKeys = conversationKeys.filter(k => k.split(':').length === 4);
    }

    if (conversationKeys.length === 0) return [];

    // Fetch all conversations in batch
    // Batch MGET in chunks of 100 to avoid huge payloads
    const chunks = [];
    for (let i = 0; i < conversationKeys.length; i += 100) {
      chunks.push(conversationKeys.slice(i, i + 100));
    }

    const conversations: AIConversation[] = [];

    for (const chunk of chunks) {
      if (chunk.length === 0) continue;
      const dataArray = await redis.mget(...chunk);

      for (const data of dataArray) {
        if (data) {
          try {
            const conversation = typeof data === 'object' ? data : JSON.parse(data as string);
            conversations.push(conversation as AIConversation);
          } catch {
            // skip bad data
          }
        }
      }
    }

    return conversations.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  } catch (error) {
    console.error('Error getting all conversations:', error);
    return [];
  }
}

export async function getAIUsageStats(): Promise<AIUsageStats> {
  if (!redis) {
    return {
      totalConversations: 0,
      totalMessages: 0,
      totalTokens: 0,
      dailyUsage: 0,
      costEstimate: 0,
      continuationCount: 0,
      lengthFinishCount: 0,
      recoveredFromLengthCount: 0,
      reasoningTokens: 0,
    };
  }

  const conversations = await getAllAIConversations();
  const totalConversations = conversations.length;
  const totalMessages = conversations.reduce((sum, conv) => sum + conv.messageCount, 0);
  const totalTokens = conversations.reduce((sum, conv) => sum + conv.totalTokens, 0);

  const today = new Date().toISOString().split('T')[0];

  let dailyUsage = 0;
  let continuationCount = 0;
  let lengthFinishCount = 0;
  let recoveredFromLengthCount = 0;
  let reasoningTokens = 0;
  try {
    // Try using the index
    const dateIndexKey = `ai:usage_index:${today}`;
    let usageKeys = await redis.smembers(dateIndexKey);

    // Fallback if index empty
    if (usageKeys.length === 0) {
      usageKeys = await redisScanKeysRaw(`ai:usage:*:${today}`);
    }

    if (usageKeys.length > 0) {
      // Chunked MGET
      const chunks = [];
      for (let i = 0; i < usageKeys.length; i += 100) {
        chunks.push(usageKeys.slice(i, i + 100));
      }

      for (const chunk of chunks) {
        if (chunk.length === 0) continue;
        const dataArray = await redis.mget(...chunk);
        for (const data of dataArray) {
          if (data) {
            const usage = typeof data === 'object' ? data : JSON.parse(data as string);
            dailyUsage += usage.tokens || 0;
            continuationCount += usage.continuations || 0;
            lengthFinishCount += usage.lengthFinishes || usage.finishReasons?.length || 0;
            recoveredFromLengthCount += usage.recoveredFromLengthCount || 0;
            reasoningTokens += usage.reasoningTokens || 0;
          }
        }
      }
    }
  } catch (error) {
    console.error('Error calculating daily usage:', error);
  }

  const config = getCurrentModelConfig();
  const costEstimate = totalTokens * config.costPerToken;

  return {
    totalConversations,
    totalMessages,
    totalTokens,
    dailyUsage,
    costEstimate,
    continuationCount,
    lengthFinishCount,
    recoveredFromLengthCount,
    reasoningTokens,
  };
}

export async function deleteAIConversation(conversationId: string): Promise<boolean> {
  if (!redis) return false;

  try {
    const pipeline = redis.pipeline();

    // 1. Get all messages to delete (using list or scan)
    const listKey = `ai:conversation_messages:${conversationId}`;
    const messageKeys = await redis.lrange(listKey, 0, -1);

    if (messageKeys.length > 0) {
      pipeline.del(...messageKeys);
    }

    // Also clean up legacy keys if any remain
    const legacyKeys = await redisScanKeysRaw(`ai:messages:${conversationId}:*`);
    if (legacyKeys.length > 0) {
      pipeline.del(...legacyKeys);
    }

    // 2. Delete conversation metadata
    const conversationKeys = await redisScanKeysRaw(`ai:conversations:*:${conversationId}`);
    if (conversationKeys.length > 0) {
      pipeline.del(...conversationKeys);
      // Also remove from index
      pipeline.srem('ai:conversations:index', ...conversationKeys);

      for (const k of conversationKeys) {
        const parts = k.split(':');
        if (parts.length >= 3) {
          const address = parts[2];
          pipeline.del(`ai:user_active_conversation:${address}`);
        }
      }
    }

    // 3. Delete the message list
    pipeline.del(listKey);

    await pipeline.exec();
    return true;
  } catch (error) {
    console.error('Error deleting AI conversation:', error);
    return false;
  }
}

export async function deleteAllAIConversations(): Promise<number> {
  if (!redis) return -1;
  const redisClient = redis;

  try {
    let conversationKeys = await redisClient.smembers('ai:conversations:index');

    if (conversationKeys.length === 0) {
      conversationKeys = await redisScanKeysRaw('ai:conversations:*');
      conversationKeys = conversationKeys.filter((k) => k.split(':').length === 4);
    }

    if (conversationKeys.length === 0) {
      return 0;
    }

    const conversationEntries = conversationKeys
      .map((key) => {
        const parts = key.split(':');
        if (parts.length !== 4) return null;
        return {
          key,
          address: parts[2],
          conversationId: parts[3],
        };
      })
      .filter((entry): entry is { key: string; address: string; conversationId: string } => Boolean(entry));

    if (conversationEntries.length === 0) {
      return 0;
    }

    const pipeline = redisClient.pipeline();
    const activeConversationKeys = new Set<string>();
    const messageListKeys: string[] = [];

    const messageKeysPerConversation = await Promise.all(
      conversationEntries.map((entry) => redisClient.lrange(`ai:conversation_messages:${entry.conversationId}`, 0, -1))
    );

    const legacyKeysPerConversation = await Promise.all(
      conversationEntries.map((entry) => redisScanKeysRaw(`ai:messages:${entry.conversationId}:*`))
    );

    conversationEntries.forEach((entry, index) => {
      const listKey = `ai:conversation_messages:${entry.conversationId}`;
      messageListKeys.push(listKey);
      activeConversationKeys.add(`ai:user_active_conversation:${entry.address}`);

      const messageKeys = messageKeysPerConversation[index];
      if (messageKeys.length > 0) {
        pipeline.del(...messageKeys);
      }

      const legacyKeys = legacyKeysPerConversation[index];
      if (legacyKeys.length > 0) {
        pipeline.del(...legacyKeys);
      }
    });

    if (conversationKeys.length > 0) {
      pipeline.del(...conversationKeys);
      pipeline.srem('ai:conversations:index', ...conversationKeys);
    }

    if (messageListKeys.length > 0) {
      pipeline.del(...messageListKeys);
    }

    const activeKeys = Array.from(activeConversationKeys);
    if (activeKeys.length > 0) {
      pipeline.del(...activeKeys);
    }

    await pipeline.exec();
    return conversationEntries.length;
  } catch (error) {
    console.error('Error deleting all AI conversations:', error);
    return -1;
  }
}
