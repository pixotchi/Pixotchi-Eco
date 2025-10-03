"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAccount } from 'wagmi';
import { usePublicClient } from 'wagmi';
import { PIXOTCHI_TOKEN_ADDRESS, LEAF_CONTRACT_ADDRESS } from '@/lib/contracts';
import { leafAbi } from '@/public/abi/leaf-abi'; 

const erc20Abi = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

interface BalanceContextType {
  seedBalance: bigint;
  leafBalance: bigint;
  loading: boolean;
  refreshBalances: () => Promise<void>;
}

const BalanceContext = createContext<BalanceContextType | undefined>(undefined);

export function BalanceProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [seedBalance, setSeedBalance] = useState<bigint>(BigInt(0));
  const [leafBalance, setLeafBalance] = useState<bigint>(BigInt(0));
  const [loading, setLoading] = useState(true);

  const fetchBalances = useCallback(async () => {
    if (!address || !publicClient) {
      setSeedBalance(BigInt(0));
      setLeafBalance(BigInt(0));
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const results = await publicClient.multicall({
        contracts: [
          {
            address: PIXOTCHI_TOKEN_ADDRESS,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
          },
          {
            address: LEAF_CONTRACT_ADDRESS,
            abi: leafAbi,
            functionName: 'balanceOf',
            args: [address],
          },
        ],
        allowFailure: true,
      });

      const [seedResult, leafResult] = results;

      setSeedBalance(seedResult.status === 'success' ? (seedResult.result as bigint) : BigInt(0));
      setLeafBalance(leafResult.status === 'success' ? (leafResult.result as bigint) : BigInt(0));

    } catch (error) {
      console.error("Failed to fetch balances via multicall:", error);
      setSeedBalance(BigInt(0));
      setLeafBalance(BigInt(0));
    } finally {
      setLoading(false);
    }
  }, [address, publicClient]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  useEffect(() => {
    // Expose a safe global refresher for non-React callers as a bridge while migrating away from events
    try {
      (window as any).__pixotchi_refresh_balances__ = fetchBalances;
    } catch {}
    
    window.addEventListener('balances:refresh', fetchBalances);
    return () => window.removeEventListener('balances:refresh', fetchBalances);
  }, [fetchBalances]);

  const value = {
    seedBalance,
    leafBalance,
    loading,
    refreshBalances: fetchBalances,
  };

  return (
    <BalanceContext.Provider value={value}>
      {children}
    </BalanceContext.Provider>
  );
}

export function useBalances() {
  const context = useContext(BalanceContext);
  if (context === undefined) {
    throw new Error('useBalances must be used within a BalanceProvider');
  }
  return context;
}
