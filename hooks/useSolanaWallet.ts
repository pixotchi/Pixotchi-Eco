'use client';

/**
 * Solana Wallet Hook
 * Integrates Privy Solana wallet with Pixotchi game context
 * 
 * MAINNET ONLY
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSolanaWalletContext, useIsSolanaWallet } from '@/lib/solana-wallet-context';
import { getTwinAddress, getTwinAddressInfo, type TwinAddressInfo } from '@/lib/solana-twin';
import { isSolanaEnabled } from '@/lib/solana-constants';

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

/**
 * Standalone hook to resolve a Solana address to Twin (outside of context)
 * Useful for one-off lookups
 */
export function useTwinAddressLookup(solanaAddress: string | null) {
  const [twinAddress, setTwinAddress] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    if (!solanaAddress || !isSolanaEnabled()) {
      setTwinAddress(null);
      return;
    }
    
    let cancelled = false;
    
    const lookup = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        // Mainnet only - no environment parameter needed
        const address = await getTwinAddress(solanaAddress);
        
        if (!cancelled) {
          setTwinAddress(address);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Lookup failed');
          setTwinAddress(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    
    lookup();
    
    return () => {
      cancelled = true;
    };
  }, [solanaAddress]);
  
  return { twinAddress, isLoading, error };
}

/**
 * Hook to get Twin info with balances
 */
export function useTwinInfo(solanaAddress: string | null) {
  const [twinInfo, setTwinInfo] = useState<TwinAddressInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const refresh = useCallback(async () => {
    if (!solanaAddress || !isSolanaEnabled()) {
      setTwinInfo(null);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Mainnet only - no environment parameter needed
      const info = await getTwinAddressInfo(solanaAddress);
      setTwinInfo(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch Twin info');
      setTwinInfo(null);
    } finally {
      setIsLoading(false);
    }
  }, [solanaAddress]);
  
  useEffect(() => {
    refresh();
  }, [refresh]);
  
  return { twinInfo, isLoading, error, refresh };
}

// Re-export for convenience
export { useIsSolanaWallet, useTwinAddress } from '@/lib/solana-wallet-context';
