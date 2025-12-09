'use client';

/**
 * Solana Wallet Context
 * Provides Solana wallet state and Twin address resolution
 * 
 * MAINNET ONLY - No devnet support
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { getTwinAddress, getTwinAddressInfo, isTwinSetup, type TwinAddressInfo } from './solana-twin';
import { getPixotchiSolanaConfig, isSolanaEnabled, SOLANA_BRIDGE_CONFIG } from './solana-constants';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

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
  const [twinAddress, setTwinAddress] = useState<string | null>(null);
  const [twinSetup, setTwinSetup] = useState(false);
  const [twinInfo, setTwinInfo] = useState<TwinAddressInfo | null>(null);
  const [solBalance, setSolBalance] = useState<bigint>(BigInt(0));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const isEnabled = isSolanaEnabled();
  
  // Fetch Twin info and SOL balance when Solana address changes
  const fetchTwinInfo = useCallback(async () => {
    if (!solanaAddress || !isEnabled) {
      setTwinAddress(null);
      setTwinSetup(false);
      setTwinInfo(null);
      setSolBalance(BigInt(0));
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const config = getPixotchiSolanaConfig();
      if (SOLANA_DEBUG) {
        console.log('[SolanaWalletContext] Fetching Twin info for:', solanaAddress);
        console.log('[SolanaWalletContext] TwinAdapter address:', config.twinAdapter);
      }
      
      // Fetch SOL balance from Solana
      try {
        const connection = new Connection(SOLANA_BRIDGE_CONFIG.solana.rpcUrl);
        const walletPubkey = new PublicKey(solanaAddress);
        const balance = await connection.getBalance(walletPubkey);
        setSolBalance(BigInt(balance));
        if (SOLANA_DEBUG) {
          console.log('[SolanaWalletContext] SOL balance:', balance / LAMPORTS_PER_SOL, 'SOL');
        }
      } catch (balErr) {
        if (SOLANA_DEBUG) {
          console.warn('[SolanaWalletContext] Failed to fetch SOL balance:', balErr);
        }
        setSolBalance(BigInt(0));
      }
      
      // Get Twin address (mainnet only)
      const address = await getTwinAddress(solanaAddress);
      setTwinAddress(address);
      if (SOLANA_DEBUG) {
        console.log('[SolanaWalletContext] Twin address:', address);
      }
      
      // Get full Twin info (mainnet only)
      const info = await getTwinAddressInfo(solanaAddress);
      setTwinInfo(info);
      if (SOLANA_DEBUG) {
        console.log('[SolanaWalletContext] Twin info:', {
          isDeployed: info.isDeployed,
          wsolBalance: info.wsolBalance?.toString(),
          seedBalance: info.seedBalance?.toString(),
        });
      }
      
      // Check if Twin is set up (has wSOL approval)
      if (config.twinAdapter) {
        const setup = await isTwinSetup(address, config.twinAdapter);
        if (SOLANA_DEBUG) {
          console.log('[SolanaWalletContext] isTwinSetup result:', setup);
        }
        setTwinSetup(setup);
      } else {
        if (SOLANA_DEBUG) {
          console.warn('[SolanaWalletContext] No twinAdapter configured, cannot check setup status');
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch Twin info';
      setError(message);
      if (SOLANA_DEBUG) {
        console.error('[SolanaWalletContext] Error fetching Twin info:', err);
      }
    } finally {
      setIsLoading(false);
    }
  }, [solanaAddress, isEnabled]);
  
  // Fetch Twin info on mount and when address changes
  useEffect(() => {
    fetchTwinInfo();
  }, [fetchTwinInfo]);
  
  // Memoized state value
  const state = useMemo<SolanaWalletState>(() => ({
    isEnabled,
    isConnected: isConnected && !!solanaAddress,
    solanaAddress,
    twinAddress,
    isTwinSetup: twinSetup,
    twinInfo,
    solBalance,
    isLoading,
    error,
    refreshTwinInfo: fetchTwinInfo,
  }), [
    isEnabled,
    isConnected,
    solanaAddress,
    twinAddress,
    twinSetup,
    twinInfo,
    solBalance,
    isLoading,
    error,
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
