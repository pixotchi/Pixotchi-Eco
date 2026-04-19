"use client";

import { createContext, useContext, ReactNode, useState, useEffect, useRef, useCallback } from "react";
import { useAccount, usePublicClient } from "wagmi";

export type SmartWalletType =
  | 'coinbase-smart'
  | 'other-smart'
  | 'eip7702-delegated'
  | 'eoa'
  | 'unknown';

export interface SmartWalletDetection {
  isSmartWallet: boolean;
  walletType: SmartWalletType;
  capabilities: null;
  detectionMethods: string[];
  isContract: boolean;
  hasCode: boolean;
  delegationTarget: string | null;
  isDelegatedEoa: boolean;
  isLoading: boolean;
  lastChecked: number | null;
}

interface SmartWalletContextType extends SmartWalletDetection {
  refetch: () => Promise<void>;
}

const SmartWalletContext = createContext<SmartWalletContextType | undefined>(undefined);

export function SmartWalletProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const [detection, setDetection] = useState<SmartWalletDetection>({
    isSmartWallet: false,
    walletType: 'unknown',
    capabilities: null,
    detectionMethods: [],
    isContract: false,
    hasCode: false,
    delegationTarget: null,
    isDelegatedEoa: false,
    isLoading: false,
    lastChecked: null,
  });

  const getAddressBytecode = useCallback(async (addr: string): Promise<`0x${string}` | undefined> => {
    if (!publicClient) return undefined;
    try {
      return await publicClient.getBytecode({ address: addr as `0x${string}` });
    } catch (error) {
      console.warn('Contract address check failed:', error);
      return undefined;
    }
  }, [publicClient]);

  const parseEip7702DelegationTarget = useCallback((code: `0x${string}` | undefined): string | null => {
    if (!code) return null;
    const normalizedCode = code.toLowerCase();
    if (!/^0xef0100[0-9a-f]{40}$/.test(normalizedCode)) {
      return null;
    }

    return `0x${normalizedCode.slice(8)}`;
  }, []);

  // Comprehensive smart wallet detection
  const detectSmartWallet = useCallback(async (): Promise<SmartWalletDetection> => {
    if (!address || !isConnected) {
      return {
        isSmartWallet: false,
        walletType: 'unknown',
        capabilities: null,
        detectionMethods: [],
        isContract: false,
        hasCode: false,
        delegationTarget: null,
        isDelegatedEoa: false,
        isLoading: false,
        lastChecked: null,
      };
    }

    // console.log('🔍 Starting comprehensive smart wallet detection (4-tier approach) for:', address);

    const results: SmartWalletDetection = {
      isSmartWallet: false,
      walletType: 'eoa',
      capabilities: null,
      detectionMethods: [],
      isContract: false,
      hasCode: false,
      delegationTarget: null,
      isDelegatedEoa: false,
      isLoading: false,
      lastChecked: Date.now(),
    };

    try {
      // Method 1: Contract address check (most definitive)
      // console.log('🔍 Method 1: Checking if address is a contract...');
      const code = await getAddressBytecode(address);
      const hasCode = code !== undefined && code !== '0x' && code.length > 2;
      const delegationTarget = parseEip7702DelegationTarget(code);

      results.hasCode = hasCode;
      results.delegationTarget = delegationTarget;

      if (delegationTarget) {
        results.isDelegatedEoa = true;
        results.walletType = 'eip7702-delegated';
        results.detectionMethods.push('eip7702-delegation');
      } else if (hasCode) {
        results.isSmartWallet = true;
        results.isContract = true;
        results.walletType = 'other-smart';
        results.detectionMethods.push('contract-address');
      }

      // Final classification
      if (!results.isSmartWallet && !results.isDelegatedEoa) {
        results.walletType = 'eoa';
      }

      // console.log('🎯 Smart Wallet Detection Results:', {
      //   address: address,
      //   isSmartWallet: results.isSmartWallet,
      //   walletType: results.walletType,
      //   detectionMethods: results.detectionMethods,
      //   isContract: results.isContract,
      //   hasCapabilities: !!results.capabilities,
      // });

      return results;

    } catch (error) {
      console.error('❌ Smart wallet detection failed:', error);
      return {
        isSmartWallet: false,
        walletType: 'unknown',
        capabilities: null,
        detectionMethods: ['error'],
        isContract: false,
        hasCode: false,
        delegationTarget: null,
        isDelegatedEoa: false,
        isLoading: false,
        lastChecked: Date.now(),
      };
    }
  }, [address, getAddressBytecode, isConnected, parseEip7702DelegationTarget]);

  // Track mounted state to prevent state updates after unmount
  const mountedRef = useRef(true);

  // Run detection when wallet connects or changes
  useEffect(() => {
    mountedRef.current = true;
    
    if (!address || !isConnected) {
      if (mountedRef.current) {
        setDetection({
          isSmartWallet: false,
          walletType: 'unknown',
          capabilities: null,
          detectionMethods: [],
          isContract: false,
          hasCode: false,
          delegationTarget: null,
          isDelegatedEoa: false,
          isLoading: false,
          lastChecked: null,
        });
      }
      return;
    }

    const runDetection = async () => {
      // Skip if recently checked (within last 30 seconds)
      if (mountedRef.current) {
        setDetection(prev => {
          if (prev.lastChecked && Date.now() - prev.lastChecked < 30000) {
            return prev; // Skip re-detection
          }
          return { ...prev, isLoading: true };
        });
      }
      
      const result = await detectSmartWallet();
      
      // Only update state if component is still mounted
      if (mountedRef.current) {
        setDetection({ ...result, isLoading: false });
      }
    };

    // Small delay to ensure wallet is fully connected
    const timer = setTimeout(runDetection, 500);
    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
    };
  }, [address, detectSmartWallet, isConnected]);

  // Manual refetch function
  const refetch = useCallback(async () => {
    if (!address || !isConnected) return;
    
    setDetection(prev => ({ ...prev, isLoading: true }));
    const result = await detectSmartWallet();
    setDetection({ ...result, isLoading: false });
  }, [address, detectSmartWallet, isConnected]);

  return (
    <SmartWalletContext.Provider 
      value={{
        ...detection,
        refetch,
      }}
    >
      {children}
    </SmartWalletContext.Provider>
  );
}

export function useSmartWallet() {
  const context = useContext(SmartWalletContext);
  if (context === undefined) {
    throw new Error('useSmartWallet must be used within a SmartWalletProvider');
  }
  return context;
}
