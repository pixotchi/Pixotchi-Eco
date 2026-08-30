/**
 * Solana Components Index
 * Export all Solana-related components
 */

export { SolanaNotSupported, SolanaBridgeBadge } from './SolanaGate';

// Re-export hooks for convenience
export { 
  useSolanaWallet, 
  useIsSolanaWallet, 
  useTwinAddress,
} from '@/hooks/useSolanaWallet';

/*
 * Deliberately NOT re-exported: useSolanaBridge. Its import chain reaches the
 * bridge executor's static `@solana/web3.js` import, and re-exporting it here
 * put the whole Solana SDK (~320KB) into the app-shell chunk for every user —
 * silently reversing the dynamic-import optimisation documented in
 * lib/solana-wallet-context.tsx. Import it from '@/hooks/useSolanaBridge'
 * directly (its one consumer is the mint tab, which is already a lazy chunk).
 */
