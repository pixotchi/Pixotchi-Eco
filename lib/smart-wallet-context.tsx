"use client";

import { createContext, useContext, ReactNode, useState, useEffect } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { isWalletACoinbaseSmartWallet } from '@coinbase/onchainkit/wallet';

export interface WalletCapabilities {
  [chainId: string]: {
    auxiliaryFunds?: { supported: boolean };
    atomic?: { supported: string };
    paymasterService?: { supported: boolean };
    flowControl?: { supported: boolean };
    datacallback?: { supported: boolean };
  };
}

export interface SmartWalletDetection {
  isSmartWallet: boolean;
  walletType: 'coinbase-smart' | 'other-smart' | 'eoa' | 'unknown';
  capabilities: WalletCapabilities | null;
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

  // Check EIP-5792 wallet capabilities
  const getWalletCapabilities = async (addr: string): Promise<WalletCapabilities | null> => {
    if (typeof window === 'undefined' || !(window as any).ethereum?.request) return null;

    try {
      const provider = (window as any).ethereum as {
        request: (args: { method: string; params?: unknown[] }) => Promise<any>;
      };
      const capabilities = await provider.request({
        method: 'wallet_getCapabilities',
        params: [addr],
      });
      return capabilities as WalletCapabilities;
    } catch (error) {
      console.log('EIP-5792 capabilities check failed:', error);
      return null;
    }
  };

  // Check if capabilities indicate smart wallet features
  const hasSmartCapabilities = (capabilities: WalletCapabilities | null): boolean => {
    if (!capabilities) return false;
    
    // Check Base mainnet capabilities (0x2105)
    const baseCapabilities = capabilities["0x2105"] || {};
    
    return !!(
      baseCapabilities.auxiliaryFunds?.supported ||
      baseCapabilities.paymasterService?.supported ||
      baseCapabilities.atomic?.supported === "supported" ||
      baseCapabilities.flowControl?.supported ||
      baseCapabilities.datacallback?.supported
    );
  };

  // Check for Coinbase Wallet indicators (basic)
  const isCoinbaseWalletClient = (): boolean => {
    const userAgent = navigator.userAgent;
    return !!(
      userAgent.includes('CoinbaseWallet') || 
      (window as any).coinbaseWalletExtension ||
      (window as any).ethereum?.isCoinbaseWallet
    );
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

      // Method 2: Coinbase Smart Wallet validation (TEMPORARILY DISABLED)
      // This method was causing false positives for EOAs
      // console.log('🔍 Method 2: OnchainKit Coinbase validation (DISABLED)');
      // console.log('⚠️ Method 2: Temporarily disabled due to false positives with EOAs');
      // console.log('💡 Method 2: Only contract address check and EIP-5792 capabilities are used');

      // Method 3: EIP-5792 capabilities (feature-based)
      // console.log('🔍 Method 3: Checking EIP-5792 capabilities...');
      const capabilities = await getWalletCapabilities(address);
      results.capabilities = capabilities;
      
      if (hasSmartCapabilities(capabilities)) {
        results.isSmartWallet = true;
        results.detectionMethods.push('eip-5792-capabilities');
        
        if (results.walletType === 'eoa') {
          results.walletType = 'other-smart';
        }
        // console.log('✅ Method 3: Smart wallet capabilities detected');
      } else {
        // console.log('❌ Method 3: No smart wallet capabilities');
      }

      // Method 4: Coinbase wallet client detection (informational only)
      // console.log('🔍 Method 4: Checking Coinbase wallet client indicators...');
      const isCoinbaseClient = isCoinbaseWalletClient();
      
      if (isCoinbaseClient) {
        // Only add to detection methods for tracking, don't change smart wallet status
        results.detectionMethods.push('coinbase-client-detected');
        // console.log('✅ Method 4: Coinbase client detected (informational only)');
        
        // If already detected as smart wallet, refine the type
        if (results.isSmartWallet && results.walletType === 'other-smart') {
          results.walletType = 'coinbase-smart';
          // console.log('📝 Method 4: Refined wallet type to coinbase-smart');
        }
      } else {
        // console.log('❌ Method 4: Not a Coinbase client');
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

  // Run detection when wallet connects or changes
  useEffect(() => {
    if (!address || !isConnected) {
      setDetection({
        isSmartWallet: false,
        walletType: 'unknown',
        capabilities: null,
        detectionMethods: [],
        isContract: false,
        isLoading: false,
        lastChecked: null,
      });
      return;
    }

    const runDetection = async () => {
      setDetection(prev => ({ ...prev, isLoading: true }));
      const result = await detectSmartWallet();
      setDetection({ ...result, isLoading: false });
    };

    // Small delay to ensure wallet is fully connected
    const timer = setTimeout(runDetection, 500);
    return () => clearTimeout(timer);
  }, [address, isConnected, publicClient]);

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