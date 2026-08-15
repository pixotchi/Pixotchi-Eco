// Environment variable configuration and validation
// This file centralizes environment variable access and validates what should be exposed

// Ensure TS knows about `process` in all environments for lint/type checks
// (Next.js will still inline NEXT_PUBLIC_* at build time)
declare const process: UntypedValue;

import {
normalizeNotificationProvider,
type NotificationProvider,
} from './notifications/provider';

const rawClientNotificationProvider = process.env.NEXT_PUBLIC_NOTIFICATION_PROVIDER;
const rawServerNotificationProvider = process.env.NOTIFICATION_PROVIDER;
const normalizedClientNotificationProvider = normalizeNotificationProvider(rawClientNotificationProvider);
const normalizedServerNotificationProvider = normalizeNotificationProvider(
  rawServerNotificationProvider || rawClientNotificationProvider,
);

// Client-safe environment variables (these are intentionally exposed)
export const CLIENT_ENV = {
  // URLs and public configuration
  APP_URL: process.env.NEXT_PUBLIC_URL || 'https://mini.pixotchi.tech',
  PONDER_API_URL: process.env.NEXT_PUBLIC_PONDER_API_URL || 'https://api.mini.pixotchi.tech/graphql',
  APP_BUILD_ID: process.env.NEXT_PUBLIC_APP_BUILD_ID || 'development',
  APP_UPDATE_CHECK_INTERVAL_SECONDS: Number(process.env.NEXT_PUBLIC_APP_UPDATE_CHECK_INTERVAL_SECONDS || '300'),

  // Contract addresses (public by nature)
  LAND_CONTRACT_ADDRESS: process.env.NEXT_PUBLIC_LAND_CONTRACT_ADDRESS_MAINNET || '0x3f1F8F0C4BE4bCeB45E6597AFe0dE861B8c3278c',
  LEAF_CONTRACT_ADDRESS: process.env.NEXT_PUBLIC_LEAF_TOKEN_ADDRESS_MAINNET || '0xE78ee52349D7b031E2A6633E07c037C3147DB116',
  STAKE_CONTRACT_ADDRESS: process.env.NEXT_PUBLIC_STAKE_CONTRACT_ADDRESS || '0xF15D93c3617525054aF05338CC6Ccf18886BD03A',
  QUEST_REWARDS_WALLET: process.env.NEXT_PUBLIC_QUEST_REWARDS_WALLET || '0xd528071FB9dC9715ea8da44e2c4433EAc017d1DB',
  QUEST_SEED_REWARDS_WALLET:
    process.env.NEXT_PUBLIC_QUEST_SEED_REWARDS_WALLET ||
    process.env.NEXT_PUBLIC_QUEST_REWARDS_WALLET ||
    '0xd528071FB9dC9715ea8da44e2c4433EAc017d1DB',
  QUEST_LEAF_REWARDS_WALLET:
    process.env.NEXT_PUBLIC_QUEST_LEAF_REWARDS_WALLET ||
    process.env.NEXT_PUBLIC_QUEST_REWARDS_WALLET ||
    '0xd528071FB9dC9715ea8da44e2c4433EAc017d1DB',

  // Feature flags
  PAYMASTER_ENABLED: process.env.NEXT_PUBLIC_PAYMASTER_ENABLED === 'true',
  GAMIFICATION_DISABLED: process.env.NEXT_PUBLIC_GAMIFICATION_DISABLED === 'true',
  // Deprecated: mini-app-only feature gating is ignored after the Base App web cutover.
  GAMIFICATION_MINIAPP_ONLY: false,
  GAMIFICATION_DISABLED_MESSAGE:
    process.env.NEXT_PUBLIC_GAMIFICATION_DISABLED_MESSAGE ||
    'Tasks and Rocks leaderboard are temporarily disabled while we reset progress for the next mission season.',
  CASINO_ENABLED: process.env.NEXT_PUBLIC_CASINO_ENABLED === 'true',
  // Deprecated: mini-app-only feature gating is ignored after the Base App web cutover.
  CASINO_MINIAPP_ONLY: false,
  BLACKJACK_ENABLED: process.env.NEXT_PUBLIC_BLACKJACK_ENABLED !== 'false',
  // Base Verify - Free plant claim for verified users
  // Single toggle controls both frontend UI and backend API
  VERIFY_CLAIM_ENABLED: process.env.NEXT_PUBLIC_VERIFY_CLAIM_ENABLED === 'true',
  // When enabled, each free plant claim also sends LEAF tokens as a bonus
  VERIFY_CLAIM_LEAF_BONUS_ENABLED: process.env.NEXT_PUBLIC_VERIFY_CLAIM_LEAF_BONUS_ENABLED === 'true',
  // When enabled, each free plant claim also sends SEED tokens (first-come-first-served)
  VERIFY_CLAIM_SEED_BONUS_ENABLED: process.env.NEXT_PUBLIC_VERIFY_CLAIM_SEED_BONUS_ENABLED === 'true',
  SWAP_MODULE_DISABLED: process.env.NEXT_PUBLIC_SWAP_MODULE_DISABLED === 'true',
  SWAP_MODULE_DISABLED_MESSAGE:
    process.env.NEXT_PUBLIC_SWAP_MODULE_DISABLED_MESSAGE ||
    "In-Game swaps are temporarily disabled but it'll be back soon! \nThanks for your patience, and apologies for the inconvenience.",
  SWAP_QUOTE_SUMMARY_ENABLED: process.env.NEXT_PUBLIC_SWAP_QUOTE_SUMMARY_ENABLED === 'true',

  // UI configuration
  ICON_URL: process.env.NEXT_PUBLIC_ICON_URL,
  HERO_IMAGE: process.env.NEXT_PUBLIC_APP_HERO_IMAGE,
  SPLASH_IMAGE: process.env.NEXT_PUBLIC_SPLASH_IMAGE,
  SPLASH_BACKGROUND_COLOR: process.env.NEXT_PUBLIC_SPLASH_BACKGROUND_COLOR || '#a8d0f0',

  // CDP/paymaster configuration (requires client access)
  CDP_CLIENT_API_KEY: process.env.NEXT_PUBLIC_CDP_CLIENT_API_KEY,
  CDP_PAYMASTER_URL: process.env.NEXT_PUBLIC_CDP_PAYMASTER_URL,
  ONCHAINKIT_PROJECT_NAME: process.env.NEXT_PUBLIC_ONCHAINKIT_PROJECT_NAME ?? 'minikit',
  STATUS_REFRESH_MINUTES: Number(process.env.NEXT_PUBLIC_STATUS_REFRESH_MINUTES || '15'),
  STATUS_SHOW_REFRESH_BUTTON: process.env.NEXT_PUBLIC_STATUS_SHOW_REFRESH_BUTTON === 'true',
  BARRACKS_ENABLED: process.env.NEXT_PUBLIC_BARRACKS_ENABLED !== 'false',
  BARRACKS_PREVIEW_ENABLED: process.env.NEXT_PUBLIC_BARRACKS_PREVIEW_ENABLED === 'true',
  BARRACKS_V2_ENABLED: process.env.NEXT_PUBLIC_BARRACKS_V2_ENABLED === 'true',
  NOTIFICATION_PROVIDER: normalizedClientNotificationProvider as NotificationProvider,

  // Optional: Batch router for bulk ERC-721 transfers
  BATCH_ROUTER_ADDRESS: process.env.NEXT_PUBLIC_BATCH_ROUTER_ADDRESS,

  // Builder Codes (ERC-8021) - for onchain activity attribution
  // Register at https://base.dev to get your builder code
  BUILDER_CODE: process.env.NEXT_PUBLIC_BUILDER_CODE || '',

  // Solana Bridge Configuration
  SOLANA_ENABLED: process.env.NEXT_PUBLIC_SOLANA_ENABLED === 'true',
  SOLANA_NETWORK: (process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'mainnet') as 'mainnet' | 'devnet',
  SOLANA_TWIN_ADAPTER: process.env.NEXT_PUBLIC_SOLANA_TWIN_ADAPTER || '',
  SOLANA_TWIN_ADAPTER_TESTNET: process.env.NEXT_PUBLIC_SOLANA_TWIN_ADAPTER_TESTNET || '',
  // Optional: Custom Solana RPC (uses public endpoint if not set)
  SOLANA_RPC_URL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || '',
} as const;

// RPC configuration with fallback handling.
//
// SERVER-ONLY. These names deliberately have no NEXT_PUBLIC_ prefix: the URLs
// embed paid provider API keys (Ankr / Alchemy / Coinbase CDP), and anything
// prefixed NEXT_PUBLIC_ is inlined verbatim into the browser bundle. The browser
// reaches Base through the /api/rpc proxy instead - see listBaseRpcEndpoints().
// Either naming works: BASE_RPC_NODE* or the shorter RPC_NODE*. What matters is
// only that there is no NEXT_PUBLIC_ prefix, so the value stays server-side.
const rpcEndpointFromEnv = (suffix: string): string | undefined =>
  process.env[`BASE_RPC_NODE${suffix}`] || process.env[`RPC_NODE${suffix}`];

export const getRpcConfig = () => {
  const endpoints = [
    rpcEndpointFromEnv(''),
    rpcEndpointFromEnv('_FALLBACK'),
    rpcEndpointFromEnv('_BACKUP_1'),
    rpcEndpointFromEnv('_BACKUP_2'),
    rpcEndpointFromEnv('_BACKUP_3'),
  ].filter((endpoint): endpoint is string => Boolean(endpoint));

  if (endpoints.length === 0) {
    throw new Error('Base RPC configuration missing: set RPC_NODE (or BASE_RPC_NODE) and backup endpoints.');
  }

  if (new Set(endpoints).size !== endpoints.length) {
    throw new Error('Base RPC endpoints must be unique.');
  }

  return { endpoints };
};

// Helper to expose RPC list to admin diagnostics (server-only safe values)
export const listRpcHttpEndpoints = (): string[] => getRpcConfig().endpoints;

// Server-only environment variables (never exposed to client)
export const SERVER_ENV = {
  // Redis configuration
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  KV_REST_API_URL: process.env.KV_REST_API_URL,
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
  KV_KV_REST_API_URL: process.env.KV_KV_REST_API_URL,
  KV_KV_REST_API_TOKEN: process.env.KV_KV_REST_API_TOKEN,
  REDIS_URL: process.env.REDIS_URL,
  REDIS_TOKEN: process.env.REDIS_TOKEN,

  // Admin configuration
  ADMIN_TOKEN: process.env.ADMIN_TOKEN,

  // Environment info
  NODE_ENV: process.env.NODE_ENV,

  // Webhook configuration
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,

  // CORS configuration for admin endpoints only
  ALLOWED_ADMIN_ORIGINS: process.env.ALLOWED_ADMIN_ORIGINS,
  ALLOWED_PUBLIC_API_ORIGINS: process.env.ALLOWED_PUBLIC_API_ORIGINS,
  NOTIFICATION_PROVIDER: normalizedServerNotificationProvider as NotificationProvider,
  // Neynar integration
  NEYNAR_API_KEY: process.env.NEYNAR_API_KEY,
  NEYNAR_APP_ID: process.env.NEYNAR_APP_ID,
  BASE_NOTIFICATIONS_API_KEY: process.env.BASE_NOTIFICATIONS_API_KEY,
  BASE_AUDIENCE_SYNC_MAX_DURATION_SECONDS: process.env.BASE_AUDIENCE_SYNC_MAX_DURATION_SECONDS,
  BASE_AUDIENCE_SYNC_EXECUTION_BUDGET_MS: process.env.BASE_AUDIENCE_SYNC_EXECUTION_BUDGET_MS,
  INDEXER_UPSTREAM_URL: process.env.INDEXER_UPSTREAM_URL,
  INDEXER_SHARED_SECRET: process.env.INDEXER_SHARED_SECRET,
  STATUS_SNAPSHOT_TTL_SECONDS: process.env.STATUS_SNAPSHOT_TTL_SECONDS,
  PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET,
  PRIVY_JWT_VERIFICATION_KEY: process.env.PRIVY_JWT_VERIFICATION_KEY,
} as const;

function getTrimmedEnvValue(key: string): string | undefined {
  const value = process.env[key];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function getPrivyChatAuthConfigStatus() {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!getTrimmedEnvValue('NEXT_PUBLIC_PRIVY_APP_ID')) {
    missing.push('NEXT_PUBLIC_PRIVY_APP_ID');
  }

  if (!getTrimmedEnvValue('PRIVY_APP_SECRET')) {
    missing.push('PRIVY_APP_SECRET');
  }

  if (!getTrimmedEnvValue('PRIVY_JWT_VERIFICATION_KEY')) {
    warnings.push(
      'PRIVY_JWT_VERIFICATION_KEY is not configured; Privy token verification will use the cached remote JWKS fallback.',
    );
  }

  return {
    missing,
    ready: missing.length === 0,
    warnings,
  };
}

// Validation function to ensure sensitive data isn't exposed
export const validateEnvSecurity = () => {
  // Avoid client-side environment introspection
  if (typeof window === 'undefined') {
    // Optionally, perform server-side sanity checks/logging here if needed
  }
};

// Call validation in development and enforce required envs in production
if (process.env.NODE_ENV === 'development') {
  validateEnvSecurity();
}

// Fail fast on missing critical envs in production (server-side only)
if (typeof window === 'undefined' && process.env.NODE_ENV === 'production') {
  if (
    rawClientNotificationProvider &&
    rawServerNotificationProvider &&
    normalizeNotificationProvider(rawClientNotificationProvider) !== normalizeNotificationProvider(rawServerNotificationProvider)
  ) {
    throw new Error('Notification provider env mismatch: NEXT_PUBLIC_NOTIFICATION_PROVIDER and NOTIFICATION_PROVIDER must match.');
  }

  const required: Array<{ key: string; present: boolean }> = [
    { key: 'NEXT_PUBLIC_URL', present: Boolean(process.env.NEXT_PUBLIC_URL) },
    { key: 'RPC_NODE (or BASE_RPC_NODE)', present: Boolean(rpcEndpointFromEnv('')) },
    { key: 'INDEXER_UPSTREAM_URL', present: Boolean(process.env.INDEXER_UPSTREAM_URL || process.env.NEXT_PUBLIC_PONDER_API_URL) },
    { key: 'INDEXER_SHARED_SECRET', present: Boolean(process.env.INDEXER_SHARED_SECRET) },
    { key: 'NEXT_PUBLIC_CDP_CLIENT_API_KEY', present: Boolean(process.env.NEXT_PUBLIC_CDP_CLIENT_API_KEY) },
    { key: 'NEXT_PUBLIC_PRIVY_APP_ID', present: Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID) },
    { key: 'PRIVY_APP_SECRET', present: Boolean(process.env.PRIVY_APP_SECRET) },
  ];
  const missing = required.filter(r => !r.present).map(r => r.key);
  if (missing.length > 0) {
    // Throwing here will surface during boot in Vercel/Node, preventing a broken prod deploy
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  getRpcConfig();
}
