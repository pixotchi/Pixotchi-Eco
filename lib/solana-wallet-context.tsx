'use client';

/**
 * Solana Wallet Context
 * Provides Solana wallet state and Twin address resolution
 * 
 * MAINNET ONLY - No devnet support
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getTwinAddressInfo, isTwinSetup, type TwinAddressInfo } from './solana-twin';
import { getPixotchiSolanaConfig, isSolanaEnabled, SOLANA_BRIDGE_CONFIG } from './solana-constants';
// NOTE: @solana/web3.js is ~321 KB and is imported dynamically below rather than
// statically. This module is reached from useIsSolanaWallet(), which is called by
// eager shell modules (the app page, status bar, balance card, wallet profile,
// chat context), so a static import pulled the whole SDK into the initial bundle
// for every user on every surface. It is only needed for the SOL balance read.

const SOLANA_DEBUG = process.env.NEXT_PUBLIC_SOLANA_DEBUG === 'true';

// ============ Types ============

export interface SolanaWalletState {
  /** Whether Solana integration is enabled */
  isEnabled: boolean;
  /** Whether a Solana wallet is connected */
  isConnected: boolean;
  /** The Solana wallet address (base58) */
  solanaAddress: string | null;
  /** The Twin address on Base */
  twinAddress: string | null;
  /** Whether the Twin is set up (has wSOL approval) */
  isTwinSetup: boolean;
  /** Full Twin info with balances */
  twinInfo: TwinAddressInfo | null;
  /** Native SOL balance on Solana (in lamports) */
  solBalance: bigint;
  /** Whether data is loading */
  isLoading: boolean;
  /** Any error that occurred */
  error: string | null;
  /** Refresh Twin info and SOL balance */
  refreshTwinInfo: () => Promise<void>;
}

// ============ Context ============

const SolanaWalletContext = createContext<SolanaWalletState | null>(null);

type SolanaWalletSnapshot = {
  ownerKey: string | null;
  twinAddress: string | null;
  twinSetup: boolean;
  twinInfo: TwinAddressInfo | null;
  solBalance: bigint;
  isLoading: boolean;
  error: string | null;
};

function createEmptySnapshot(
  ownerKey: string | null = null,
  isLoading = false,
  error: string | null = null,
): SolanaWalletSnapshot {
  return {
    ownerKey,
    twinAddress: null,
    twinSetup: false,
    twinInfo: null,
    solBalance: BigInt(0),
    isLoading,
    error,
  };
}

// ============ Provider Props ============

interface SolanaWalletProviderProps {
  children: React.ReactNode;
  /** Solana wallet address from Privy (if connected) */
  solanaAddress?: string | null;
  /** Whether a Solana wallet is connected */
  isConnected?: boolean;
}

// ============ Provider Component ============

export function SolanaWalletProvider({
  children,
  solanaAddress = null,
  isConnected = false,
}: SolanaWalletProviderProps) {
  const isEnabled = isSolanaEnabled();
  const ownerKey = isEnabled && isConnected && solanaAddress ? solanaAddress : null;
  const ownerKeyRef = useRef(ownerKey);
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  ownerKeyRef.current = ownerKey;

  const [snapshot, setSnapshot] = useState<SolanaWalletSnapshot>(() => createEmptySnapshot());
  const visibleSnapshot = useMemo(
    () => snapshot.ownerKey === ownerKey
      ? snapshot
      : createEmptySnapshot(ownerKey, Boolean(ownerKey)),
    [ownerKey, snapshot],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, []);
  
  // Fetch Twin info and SOL balance when Solana address changes
  const fetchTwinInfo = useCallback(async () => {
    const requestedOwnerKey = ownerKey;
    const requestedSolanaAddress = solanaAddress;

    // Context callbacks may outlive the render that created them. A stale manual
    // refresh must not invalidate the replacement wallet's active request.
    if (!mountedRef.current || ownerKeyRef.current !== requestedOwnerKey) return;

    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;

    if (!requestedSolanaAddress || !requestedOwnerKey) {
      if (mountedRef.current) setSnapshot(createEmptySnapshot());
      return;
    }

    const isCurrentRequest = () =>
      mountedRef.current
      && requestGenerationRef.current === generation
      && ownerKeyRef.current === requestedOwnerKey;

    setSnapshot(createEmptySnapshot(requestedOwnerKey, true));
    
    try {
      const config = getPixotchiSolanaConfig();
      if (SOLANA_DEBUG) {
        console.log('[SolanaWalletContext] Fetching Twin info for:', requestedSolanaAddress);
        console.log('[SolanaWalletContext] TwinAdapter address:', config.twinAdapter);
      }

      let nextSolBalance = BigInt(0);
      let balanceError: string | null = null;

      // Fetch SOL balance from Solana
      try {
        const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
        const connection = new Connection(SOLANA_BRIDGE_CONFIG.solana.rpcUrl);
        const walletPubkey = new PublicKey(requestedSolanaAddress);
        const balance = await connection.getBalance(walletPubkey);
        nextSolBalance = BigInt(balance);
        if (SOLANA_DEBUG) {
          console.log('[SolanaWalletContext] SOL balance:', balance / LAMPORTS_PER_SOL, 'SOL');
        }
      } catch (balErr) {
        balanceError = 'Native SOL balance could not be loaded';
        if (SOLANA_DEBUG) {
          console.warn('[SolanaWalletContext] Failed to fetch SOL balance:', balErr);
        }
      }
      
      // Resolve the Twin and its balances in one read flow. getTwinAddressInfo
      // already derives the address, so calling getTwinAddress first duplicated a
      // Base RPC request on every profile load and refresh.
      const info = await getTwinAddressInfo(requestedSolanaAddress);
      const address = info.twinAddress;
      if (SOLANA_DEBUG) {
        console.log('[SolanaWalletContext] Twin address:', address);
      }

      if (SOLANA_DEBUG) {
        console.log('[SolanaWalletContext] Twin info:', {
          isDeployed: info.isDeployed,
          wsolBalance: info.wsolBalance?.toString(),
          seedBalance: info.seedBalance?.toString(),
        });
      }
      
      // Check if Twin is set up (has wSOL approval)
      let setup = false;
      if (config.twinAdapter) {
        setup = await isTwinSetup(address, config.twinAdapter);
        if (SOLANA_DEBUG) {
          console.log('[SolanaWalletContext] isTwinSetup result:', setup);
        }
      } else {
        if (SOLANA_DEBUG) {
          console.warn('[SolanaWalletContext] No twinAdapter configured, cannot check setup status');
        }
      }

      if (!isCurrentRequest()) return;
      setSnapshot({
        ownerKey: requestedOwnerKey,
        twinAddress: address,
        twinSetup: setup,
        twinInfo: info,
        solBalance: nextSolBalance,
        isLoading: false,
        error: balanceError,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch Twin info';
      if (SOLANA_DEBUG) {
        console.error('[SolanaWalletContext] Error fetching Twin info:', err);
      }
      if (isCurrentRequest()) {
        setSnapshot(createEmptySnapshot(requestedOwnerKey, false, message));
      }
    }
  }, [ownerKey, solanaAddress]);
  
  // Fetch Twin info on mount and when address changes
  useEffect(() => {
    void fetchTwinInfo();
  }, [fetchTwinInfo]);
  
  // Memoized state value
  const state = useMemo<SolanaWalletState>(() => ({
    isEnabled,
    isConnected: Boolean(ownerKey),
    solanaAddress,
    twinAddress: visibleSnapshot.twinAddress,
    isTwinSetup: visibleSnapshot.twinSetup,
    twinInfo: visibleSnapshot.twinInfo,
    solBalance: visibleSnapshot.solBalance,
    isLoading: visibleSnapshot.isLoading,
    error: visibleSnapshot.error,
    refreshTwinInfo: fetchTwinInfo,
  }), [
    isEnabled,
    ownerKey,
    solanaAddress,
    visibleSnapshot,
    fetchTwinInfo,
  ]);
  
  return (
    <SolanaWalletContext.Provider value={state}>
      {children}
    </SolanaWalletContext.Provider>
  );
}

// ============ Hook ============

/**
 * Hook to access Solana wallet context
 * @throws If used outside of SolanaWalletProvider
 */
export function useSolanaWalletContext(): SolanaWalletState {
  const context = useContext(SolanaWalletContext);
  
  if (!context) {
    throw new Error('useSolanaWalletContext must be used within a SolanaWalletProvider');
  }
  
  return context;
}

/**
 * Hook to check if current user is using a Solana wallet
 * Safe to use outside of provider (returns false)
 */
export function useIsSolanaWallet(): boolean {
  const context = useContext(SolanaWalletContext);
  return context?.isConnected ?? false;
}

/**
 * Hook to get Twin address (or null if not Solana wallet)
 * Safe to use outside of provider (returns null)
 */
export function useTwinAddress(): string | null {
  const context = useContext(SolanaWalletContext);
  return context?.twinAddress ?? null;
}
