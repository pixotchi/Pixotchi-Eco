"use client";

import { createContext, useContext, useEffect, ReactNode, useCallback, useMemo, useRef } from "react";
import { useAccount, useReadContracts } from 'wagmi';
import { PIXOTCHI_TOKEN_ADDRESS, LEAF_CONTRACT_ADDRESS, CREATOR_TOKEN_ADDRESS, ERC20_BALANCE_ABI } from '@/lib/contracts';
import { leafAbi } from '@/public/abi/leaf-abi';
import { useSolanaWalletContext } from '@/lib/solana-wallet-context';
import { onBalanceRefresh } from '@/lib/app-events';

export interface BalanceContextType {
  seedBalance: bigint;
  leafBalance: bigint;
  pixotchiBalance: bigint;
  loading: boolean;
  refreshBalances: () => Promise<void>;
}

const BalanceContext = createContext<BalanceContextType | undefined>(undefined);

export function BalanceProvider({ children }: { children: ReactNode }) {
  const { address: evmAddress, isConnected: isEvmConnected } = useAccount();

  // Get Solana wallet info - use Twin address for balance queries
  const { twinAddress, isConnected: isSolanaConnected } = useSolanaWalletContext();

  // Use EVM address for EVM wallets, Twin address for Solana wallets
  const address = evmAddress || (isSolanaConnected ? twinAddress as `0x${string}` : undefined);
  const isConnected = isEvmConnected || isSolanaConnected;

  // Use wagmi's useReadContracts for automatic fetching, caching, and deduplication
  const { data, refetch, isLoading: isWagmiLoading } = useReadContracts({
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

  const addressRef = useRef(address);
  const refetchRef = useRef(refetch);
  addressRef.current = address;
  refetchRef.current = refetch;

  useEffect(() => {
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshTargetAt = Number.POSITIVE_INFINITY;
    let refreshInFlight = false;
    let refreshQueued = false;
    const seenRefreshes = new Map<string, { seenAt: number; targetAt: number }>();

    const runRefresh = async () => {
      if (!active) return;
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }

      refreshInFlight = true;
      try {
        await refetchRef.current();
      } catch (error) {
        console.warn("Balance reconciliation failed", error);
      } finally {
        refreshInFlight = false;
        if (active && refreshQueued) {
          refreshQueued = false;
          refreshTargetAt = Date.now() + 100;
          refreshTimer = setTimeout(() => {
            refreshTimer = null;
            refreshTargetAt = Number.POSITIVE_INFINITY;
            void runRefresh();
          }, 100);
        }
      }
    };

    const unsubscribe = onBalanceRefresh((detail) => {
      const currentAddress = addressRef.current?.toLowerCase();
      if (detail.address && currentAddress && detail.address.toLowerCase() !== currentAddress) {
        return;
      }

      const dedupeKey = detail.transactionHash?.toLowerCase()
        || detail.transactionId
        || detail.dedupeKey
        || detail.eventId;
      const now = Date.now();
      const targetAt = now + detail.delayMs;
      const recent = seenRefreshes.get(dedupeKey);
      if (recent && now - recent.seenAt < 15_000 && recent.targetAt <= targetAt) return;
      seenRefreshes.set(dedupeKey, { seenAt: now, targetAt });
      if (seenRefreshes.size > 100) {
        for (const [key, recentRefresh] of seenRefreshes) {
          if (now - recentRefresh.seenAt >= 15_000) seenRefreshes.delete(key);
        }
        while (seenRefreshes.size > 100) {
          const oldestKey = seenRefreshes.keys().next().value as string | undefined;
          if (!oldestKey) break;
          seenRefreshes.delete(oldestKey);
        }
      }

      if (refreshTimer !== null && refreshTargetAt <= targetAt) return;
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      refreshTargetAt = targetAt;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        refreshTargetAt = Number.POSITIVE_INFINITY;
        void runRefresh();
      }, Math.max(0, targetAt - Date.now()));
    });

    return () => {
      active = false;
      unsubscribe();
      if (refreshTimer !== null) clearTimeout(refreshTimer);
    };
  }, []);


  const refreshBalances = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // Memoized: this provider sits high in the tower, so a fresh object literal here
  // re-rendered every consumer on any parent render, not just on a balance change.
  const value = useMemo(
    () => ({
      seedBalance,
      leafBalance,
      pixotchiBalance,
      // Show loading only on initial load, not during refetches (optimistic UI)
      loading: isWagmiLoading && !data,
      refreshBalances,
    }),
    [seedBalance, leafBalance, pixotchiBalance, isWagmiLoading, data, refreshBalances],
  );

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
