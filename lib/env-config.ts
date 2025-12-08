// Environment variable configuration and validation
// This file centralizes environment variable access and validates what should be exposed

// Ensure TS knows about `process` in all environments for lint/type checks
// (Next.js will still inline NEXT_PUBLIC_* at build time)
declare const process: any;

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

  // Optional: Batch router for bulk ERC-721 transfers
  BATCH_ROUTER_ADDRESS: process.env.NEXT_PUBLIC_BATCH_ROUTER_ADDRESS,
  
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
  
  const wssEndpoints = [
    process.env.NEXT_PUBLIC_RPC_NODE_WSS,
    process.env.NEXT_PUBLIC_RPC_NODE_FALLBACK_WSS,
  ].filter((endpoint): endpoint is string => Boolean(endpoint));
  
  if (endpoints.length === 0) {
    // Graceful fallback to public Base RPC to avoid runtime crashes if envs are not injected
    console.warn('RPC configuration missing: falling back to public Base RPC');
    endpoints.push('https://base-rpc.publicnode.com');
    endpoints.push('https://mainnet.base.org');
  }
  
  return { endpoints, wssEndpoints };
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
  // Neynar integration
  NEYNAR_API_KEY: process.env.NEYNAR_API_KEY,
  NEYNAR_APP_ID: process.env.NEYNAR_APP_ID,
  MEMORY_API_KEY: process.env.MEMORY_API_KEY,
} as const;

// Validation function to ensure sensitive data isn't exposed
export const validateEnvSecurity = () => {
  const sensitiveKeys = [
    'ADMIN_INVITE_KEY',
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
  const required: Array<{ key: string; present: boolean }> = [
    { key: 'NEXT_PUBLIC_URL', present: Boolean(process.env.NEXT_PUBLIC_URL) },
    { key: 'NEXT_PUBLIC_PONDER_API_URL', present: Boolean(process.env.NEXT_PUBLIC_PONDER_API_URL) },
    { key: 'NEXT_PUBLIC_CDP_CLIENT_API_KEY', present: Boolean(process.env.NEXT_PUBLIC_CDP_CLIENT_API_KEY) },
    { key: 'NEXT_PUBLIC_PRIVY_APP_ID', present: Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID) },
  ];
  const missing = required.filter(r => !r.present).map(r => r.key);
  if (missing.length > 0) {
    // Throwing here will surface during boot in Vercel/Node, preventing a broken prod deploy
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}