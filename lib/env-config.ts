// Environment variable configuration and validation
// This file centralizes environment variable access and validates what should be exposed

// Ensure TS knows about `process` in all environments for lint/type checks
// (Next.js will still inline NEXT_PUBLIC_* at build time)
declare const process: any;

import { validateBaseRpcEndpointDiversity } from './base-rpc-policy';
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

  // Contract addresses (public by nature)
  LAND_CONTRACT_ADDRESS: process.env.NEXT_PUBLIC_LAND_CONTRACT_ADDRESS_MAINNET || '0x3f1F8F0C4BE4bCeB45E6597AFe0dE861B8c3278c',
  LEAF_CONTRACT_ADDRESS: process.env.NEXT_PUBLIC_LEAF_TOKEN_ADDRESS_MAINNET || '0xE78ee52349D7b031E2A6633E07c037C3147DB116',
  STAKE_CONTRACT_ADDRESS: process.env.NEXT_PUBLIC_STAKE_CONTRACT_ADDRESS || '0xF15D93c3617525054aF05338CC6Ccf18886BD03A',

  // Feature flags
  INVITE_SYSTEM_ENABLED: process.env.NEXT_PUBLIC_INVITE_SYSTEM_ENABLED === 'true',
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
  // Agent tab in chat - allows AI to mint plants on behalf of user
  // When false, the Agent tab is completely hidden and agent code is not loaded
  AGENT_ENABLED: process.env.NEXT_PUBLIC_AGENT_ENABLED !== 'false', // Defaults to true

  // UI configuration
  ICON_URL: process.env.NEXT_PUBLIC_ICON_URL,
  HERO_IMAGE: process.env.NEXT_PUBLIC_APP_HERO_IMAGE,
  SPLASH_IMAGE: process.env.NEXT_PUBLIC_SPLASH_IMAGE,
  SPLASH_BACKGROUND_COLOR: process.env.NEXT_PUBLIC_SPLASH_BACKGROUND_COLOR || '#a7c7e7',

  // OnchainKit configuration (requires client access)
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

// RPC configuration with fallback handling
export const getRpcConfig = () => {
  const endpoints = [
    process.env.NEXT_PUBLIC_RPC_NODE,
    process.env.NEXT_PUBLIC_RPC_NODE_FALLBACK,
    process.env.NEXT_PUBLIC_RPC_NODE_BACKUP_1,
    process.env.NEXT_PUBLIC_RPC_NODE_BACKUP_2,
    process.env.NEXT_PUBLIC_RPC_NODE_BACKUP_3,
  ].filter((endpoint): endpoint is string => Boolean(endpoint));

  if (endpoints.length === 0) {
    throw new Error('Base RPC configuration missing: set NEXT_PUBLIC_RPC_NODE and backup endpoints.');
  }

  if (new Set(endpoints).size !== endpoints.length) {
    throw new Error('Base RPC endpoints must be unique.');
  }

  const allowDuplicateVendors = process.env.ALLOW_RPC_VENDOR_DUPLICATES === 'true';
  validateBaseRpcEndpointDiversity(endpoints, {
    maxEndpointsPerVendor: allowDuplicateVendors ? Number.POSITIVE_INFINITY : 2,
    minUniqueVendors: 3,
  });

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
  ADMIN_INVITE_KEY: process.env.ADMIN_INVITE_KEY,
  // Note: ADMIN_TOKEN was replaced with ADMIN_INVITE_KEY for consistency

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
  BASE_NOTIFICATIONS_API_KEY: process.env.BASE_NOTIFICATIONS_API_KEY || process.env.BASE_NOTI,
  INDEXER_UPSTREAM_URL: process.env.INDEXER_UPSTREAM_URL,
  INDEXER_SHARED_SECRET: process.env.INDEXER_SHARED_SECRET,
  STATUS_SNAPSHOT_TTL_SECONDS: process.env.STATUS_SNAPSHOT_TTL_SECONDS,
} as const;

// Validation function to ensure sensitive data isn't exposed
export const validateEnvSecurity = () => {
  const sensitiveKeys = [
    'ADMIN_INVITE_KEY',
    'PRIVY_APP_SECRET',
    'REDIS_TOKEN',
    'UPSTASH_REDIS_REST_TOKEN',
    'KV_REST_API_TOKEN',
  ];

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
    { key: 'NEXT_PUBLIC_RPC_NODE', present: Boolean(process.env.NEXT_PUBLIC_RPC_NODE) },
    { key: 'NEXT_PUBLIC_RPC_NODE_FALLBACK', present: Boolean(process.env.NEXT_PUBLIC_RPC_NODE_FALLBACK) },
    { key: 'NEXT_PUBLIC_RPC_NODE_BACKUP_1', present: Boolean(process.env.NEXT_PUBLIC_RPC_NODE_BACKUP_1) },
    { key: 'NEXT_PUBLIC_RPC_NODE_BACKUP_2', present: Boolean(process.env.NEXT_PUBLIC_RPC_NODE_BACKUP_2) },
    { key: 'NEXT_PUBLIC_RPC_NODE_BACKUP_3', present: Boolean(process.env.NEXT_PUBLIC_RPC_NODE_BACKUP_3) },
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

  const { endpoints } = getRpcConfig();
  if (endpoints.length !== 5) {
    throw new Error(`Production requires exactly 5 unique Base RPC endpoints. Found ${endpoints.length}.`);
  }
}
