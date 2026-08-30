'use client';

/**
 * Solana Wallet Hook
 * Integrates Privy Solana wallet with Pixotchi game context
 * 
 * MAINNET ONLY
 */

import type { TwinAddressInfo } from '@/lib/solana-twin';
import { useSolanaWalletContext } from '@/lib/solana-wallet-context';
import { useMemo } from 'react';

// ============ Types ============

export interface SolanaWalletHook {
  /** Whether Solana features are enabled */
  isEnabled: boolean;
  /** Whether a Solana wallet is connected */
  isConnected: boolean;
  /** Solana wallet address (base58) */
  solanaAddress: string | null;
  /** Twin address on Base */
  twinAddress: string | null;
  /** Whether Twin is set up (approved wSOL) */
  isTwinSetup: boolean;
  /** Twin info with balances */
  twinInfo: TwinAddressInfo | null;
  /** Native SOL balance on Solana (in lamports) */
  solBalance: bigint;
  /** Whether loading */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refresh Twin info and SOL balance */
  refresh: () => Promise<void>;
  /** Get the effective address to query for plants (Twin or regular wallet) */
  effectiveAddress: string | null;
}

// ============ Hook ============

/**
 * Hook to manage Solana wallet state and Twin resolution
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isConnected, twinAddress, effectiveAddress } = useSolanaWallet();
 *   
 *   // Query plants using effectiveAddress (works for both Solana and regular wallets)
 *   const plants = usePlantsByOwner(effectiveAddress);
 * }
 * ```
 */
export function useSolanaWallet(): SolanaWalletHook {
  const context = useSolanaWalletContext();
  
  // The effective address is the Twin address for Solana users,
  // or the regular wallet address for EVM users
  // This is used for querying assets (plants, balances, etc.)
  const effectiveAddress = useMemo(() => {
    if (context.isConnected && context.twinAddress) {
      return context.twinAddress;
    }
    return null;
  }, [context.isConnected, context.twinAddress]);
  
  return {
    isEnabled: context.isEnabled,
    isConnected: context.isConnected,
    solanaAddress: context.solanaAddress,
    twinAddress: context.twinAddress,
    isTwinSetup: context.isTwinSetup,
    twinInfo: context.twinInfo,
    solBalance: context.solBalance,
    isLoading: context.isLoading,
    error: context.error,
    refresh: context.refreshTwinInfo,
    effectiveAddress,
  };
}

// Re-export for convenience
export { useIsSolanaWallet,useTwinAddress } from '@/lib/solana-wallet-context';
