"use client";

import { createContext, useContext, useEffect, useCallback, ReactNode } from 'react';
import { useAccount, useReadContracts } from 'wagmi';
import { PIXOTCHI_TOKEN_ADDRESS, LEAF_CONTRACT_ADDRESS, CREATOR_TOKEN_ADDRESS, ERC20_BALANCE_ABI } from '@/lib/contracts';
import { leafAbi } from '@/public/abi/leaf-abi';
import { useSolanaWalletContext } from '@/lib/solana-wallet-context';

export interface BalanceContextType {
  seedBalance: bigint;
  leafBalance: bigint;
  pixotchiBalance: bigint;
  loading: boolean;
  refreshBalances: () => Promise<void>;
}

const BalanceContext = createContext<BalanceContextType | undefined>(undefined);

// Debounce utility function for user-initiated rapid refreshes
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return function debounced(...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, wait);
  };
}

export function BalanceProvider({ children }: { children: ReactNode }) {
  const { address: evmAddress, isConnected: isEvmConnected } = useAccount();

  // Get Solana wallet info - use Twin address for balance queries
  const { twinAddress, isConnected: isSolanaConnected } = useSolanaWalletContext();

  // Use EVM address for EVM wallets, Twin address for Solana wallets
  const address = evmAddress || (isSolanaConnected ? twinAddress as `0x${string}` : undefined);
  const isConnected = isEvmConnected || isSolanaConnected;

  // Use wagmi's useReadContracts for automatic fetching, caching, and deduplication
  const { data, refetch, isLoading: isWagmiLoading, isRefetching } = useReadContracts({
    contracts: [
      {
        address: PIXOTCHI_TOKEN_ADDRESS,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: address ? [address] : undefined,
      },
      {
        address: LEAF_CONTRACT_ADDRESS,
        abi: leafAbi,
        functionName: 'balanceOf',
        args: address ? [address] : undefined,
      },
      {
        address: CREATOR_TOKEN_ADDRESS,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: address ? [address] : undefined,
      },
    ],
    query: {
      enabled: !!address && isConnected,
      staleTime: 10_000, // Consider data fresh for 10 seconds
      refetchInterval: 30_000, // Auto-refetch every 30 seconds
    }
  });

  const seedBalance = data?.[0]?.result as bigint ?? BigInt(0);
  const leafBalance = data?.[1]?.result as bigint ?? BigInt(0);
  const pixotchiBalance = data?.[2]?.result as bigint ?? BigInt(0);

  // Expose a safe global refresher for non-React callers
  const handleRefresher = useCallback(async () => {
    await refetch();
  }, [refetch]);

  useEffect(() => {
    try {
      (window as any).__pixotchi_refresh_balances__ = handleRefresher;
    } catch { }

    // Listen for transaction-triggered refresh events
    const handleRefreshEvent = () => {
      // Small delay to allow blockchain state to propagate
      // Base has fast 1-2 second block times, so 500ms is sufficient
      setTimeout(() => {
        refetch();
      }, 500);
    };

    window.addEventListener('balances:refresh', handleRefreshEvent);
    return () => {
      window.removeEventListener('balances:refresh', handleRefreshEvent);
    };
  }, [handleRefresher, refetch]);


  const value = {
    seedBalance,
    leafBalance,
    pixotchiBalance,
    // Show loading only on initial load, not during refetches (optimistic UI)
    loading: isWagmiLoading && !data,
    refreshBalances: async () => { await refetch(); },
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
