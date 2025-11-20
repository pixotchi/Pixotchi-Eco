"use client";

import { createContext, useContext, ReactNode, useState, useEffect, useRef } from "react";
import { useAccount, usePublicClient } from "wagmi";

export interface SmartWalletDetection {
  isSmartWallet: boolean;
  walletType: 'coinbase-smart' | 'other-smart' | 'eoa' | 'unknown';
  capabilities: null;
  detectionMethods: string[];
  isContract: boolean;
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
    isLoading: false,
    lastChecked: null,
  });

  // Check if address is a smart contract
  const isContractAddress = async (addr: string): Promise<boolean> => {
    if (!publicClient) return false;
    try {
      const code = await publicClient.getBytecode({ address: addr as `0x${string}` });
      return code !== undefined && code !== '0x' && code.length > 2;
    } catch (error) {
      console.warn('Contract address check failed:', error);
      return false;
    }
  };

  // Comprehensive smart wallet detection
  const detectSmartWallet = async (): Promise<SmartWalletDetection> => {
    if (!address || !isConnected) {
      return {
        isSmartWallet: false,
        walletType: 'unknown',
        capabilities: null,
        detectionMethods: [],
        isContract: false,
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
      isLoading: false,
      lastChecked: Date.now(),
    };

    try {
      // Method 1: Contract address check (most definitive)
      // console.log('🔍 Method 1: Checking if address is a contract...');
      const isContract = await isContractAddress(address);
      results.isContract = isContract;
      
      if (isContract) {
        results.isSmartWallet = true;
        results.detectionMethods.push('contract-address');
        // console.log('✅ Method 1: Address is a smart contract');
      } else {
        // console.log('❌ Method 1: Address is not a contract (EOA)');
      }

      // Simplified: Only use contract code to determine smart wallet
      if (results.isSmartWallet) {
        results.walletType = 'other-smart';
      }



      // Final classification
      if (!results.isSmartWallet) {
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
        isLoading: false,
        lastChecked: Date.now(),
      };
    }
  };

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
          isLoading: false,
          lastChecked: null,
        });
      }
      return;
    }

    const runDetection = async () => {
      // Check sessionStorage cache first
      const cacheKey = `smart-wallet-detection-${address}`;
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          // Use cache if it's less than 24 hours old
          if (parsed.lastChecked && Date.now() - parsed.lastChecked < 86400000) {
             if (mountedRef.current) {
               setDetection(parsed);
               return;
             }
          }
        }
      } catch (e) {
        // Ignore cache errors
      }

      // Skip if recently checked in memory (within last 30 seconds)
      if (mountedRef.current) {
        setDetection(prev => {
          if (prev.lastChecked && Date.now() - prev.lastChecked < 30000) {
            return prev; // Skip re-detection
          }
          return { ...prev, isLoading: true };
        });
      }
      
      const result = await detectSmartWallet();
      
      // Save to sessionStorage
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify(result));
      } catch (e) {
        // Ignore storage errors
      }

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
  }, [address, isConnected]); // Removed publicClient from deps to prevent unnecessary re-runs

  // Manual refetch function
  const refetch = async () => {
    if (!address || !isConnected) return;
    
    setDetection(prev => ({ ...prev, isLoading: true }));
    const result = await detectSmartWallet();
    setDetection({ ...result, isLoading: false });
  };

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