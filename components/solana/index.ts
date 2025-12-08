/**
 * Solana Components Index
 * Export all Solana-related components
 */

// Provider
export { SolanaWalletProvider, withSolanaWallet } from './SolanaWalletProvider';

// Transaction UI
export { SolanaBridgeTransaction } from './SolanaBridgeTransaction';

// Gating components
export { 
  SolanaGate, 
  SolanaOnly, 
  HideFromSolana, 
  SolanaNotSupported,
  SolanaBridgeBadge,
} from './SolanaGate';

// Re-export hooks for convenience
export { 
  useSolanaWallet, 
  useIsSolanaWallet, 
  useTwinAddress,
  useTwinAddressLookup,
  useTwinInfo,
} from '@/hooks/useSolanaWallet';

export { useSolanaBridge } from '@/hooks/useSolanaBridge';

// Re-export utility functions
export { isSolanaEnabled } from '@/lib/solana-constants';

// Re-export types
export type { SolanaBridgeTransactionProps } from './SolanaBridgeTransaction';
