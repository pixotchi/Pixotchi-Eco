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
  seedBalanceStatus: BalanceReadStatus;
  leafBalanceStatus: BalanceReadStatus;
  pixotchiBalanceStatus: BalanceReadStatus;
  balanceError: unknown;
  loading: boolean;
  refreshBalances: () => Promise<void>;
}

export type BalanceReadStatus = 'unknown' | 'ready' | 'error';

type BalanceSnapshot = {
  seedBalance: bigint;
  leafBalance: bigint;
  pixotchiBalance: bigint;
};

function readBalanceResult(value: UntypedValue): { value: bigint | null; error: unknown } {
  if (value?.status === 'success' && typeof value.result === 'bigint') {
    return { value: value.result, error: null };
  }
  // Older wagmi result shapes may omit status while still exposing a valid result.
  if (value?.status === undefined && !value?.error && typeof value?.result === 'bigint') {
    return { value: value.result, error: null };
  }
  return { value: null, error: value?.error ?? null };
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
  const { data, refetch, isLoading: isWagmiLoading, error: wagmiError } = useReadContracts({
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

  const identity = address?.toLowerCase() ?? null;
  const lastKnownByAddressRef = useRef(new Map<string, BalanceSnapshot>());
  const seedRead = readBalanceResult(data?.[0]);
  const leafRead = readBalanceResult(data?.[1]);
  const pixotchiRead = readBalanceResult(data?.[2]);
  const lastKnown = identity ? lastKnownByAddressRef.current.get(identity) : undefined;
  const seedBalance = seedRead.value ?? lastKnown?.seedBalance ?? BigInt(0);
  const leafBalance = leafRead.value ?? lastKnown?.leafBalance ?? BigInt(0);
  const pixotchiBalance = pixotchiRead.value ?? lastKnown?.pixotchiBalance ?? BigInt(0);
  const balanceReadSettled = Boolean(identity && isConnected && !isWagmiLoading && (data !== undefined || wagmiError));
  const getBalanceReadStatus = (read: { value: bigint | null; error: unknown }, snapshot?: bigint): BalanceReadStatus => {
    if (wagmiError) return 'error';
    if (read.value !== null) return 'ready';
    if (snapshot !== undefined) return 'error';
    if (balanceReadSettled) return 'error';
    return 'unknown';
  };
  const seedBalanceStatus = getBalanceReadStatus(seedRead, lastKnown?.seedBalance);
  const leafBalanceStatus = getBalanceReadStatus(leafRead, lastKnown?.leafBalance);
  const pixotchiBalanceStatus = getBalanceReadStatus(pixotchiRead, lastKnown?.pixotchiBalance);
  const balanceError = seedRead.error ?? leafRead.error ?? pixotchiRead.error ?? wagmiError ?? null;

  useEffect(() => {
    if (!identity || (seedRead.value === null && leafRead.value === null && pixotchiRead.value === null)) return;
    const previous = lastKnownByAddressRef.current.get(identity);
    lastKnownByAddressRef.current.set(identity, {
      // Persist each successful read independently. A single RPC failure must
      // not discard a newer good value or make a later render fall back to 0.
      seedBalance: seedRead.value ?? previous?.seedBalance ?? BigInt(0),
      leafBalance: leafRead.value ?? previous?.leafBalance ?? BigInt(0),
      pixotchiBalance: pixotchiRead.value ?? previous?.pixotchiBalance ?? BigInt(0),
    });
  }, [identity, leafRead.value, pixotchiRead.value, seedRead.value]);

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
      seedBalanceStatus,
      leafBalanceStatus,
      pixotchiBalanceStatus,
      balanceError,
      // Keep the existing skeleton behavior for the initial read; background
      // refresh failures retain the last known snapshot and expose an error
      // status instead of rewriting balances to zero.
      loading: isWagmiLoading && !data,
      refreshBalances,
    }),
    [balanceError, isWagmiLoading, data, leafBalance, leafBalanceStatus, pixotchiBalance, pixotchiBalanceStatus, refreshBalances, seedBalance, seedBalanceStatus],
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
