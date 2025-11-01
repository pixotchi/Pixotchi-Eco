"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { useAccount } from 'wagmi';
import { usePublicClient } from 'wagmi';
import { PIXOTCHI_TOKEN_ADDRESS, LEAF_CONTRACT_ADDRESS, ERC20_BALANCE_ABI } from '@/lib/contracts';
import { leafAbi } from '@/public/abi/leaf-abi'; 

interface BalanceContextType {
  seedBalance: bigint;
  leafBalance: bigint;
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
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [seedBalance, setSeedBalance] = useState<bigint>(BigInt(0));
  const [leafBalance, setLeafBalance] = useState<bigint>(BigInt(0));
  const [loading, setLoading] = useState(true);
  
  // Request deduplication (only for concurrent requests, not for login)
  const pendingRequestRef = useRef<Promise<void> | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const lastAddressRef = useRef<string | undefined>(undefined);
  const lastConnectedRef = useRef<boolean>(false);
  const MIN_FETCH_INTERVAL = 500; // Only applies to rapid user-initiated refreshes

  const fetchBalances = useCallback(async (bypassThrottle: boolean = false, force: boolean = false) => {
    if (!address || !publicClient) {
      setSeedBalance(BigInt(0));
      setLeafBalance(BigInt(0));
      setLoading(false);
      return;
    }

    // Deduplicate concurrent requests, but allow force refresh for login
    if (!force && pendingRequestRef.current) {
      return pendingRequestRef.current;
    }

    // Throttle rapid requests, but allow bypass for transaction-triggered refreshes and login
    if (!bypassThrottle && !force) {
      const now = Date.now();
      if (now - lastFetchTimeRef.current < MIN_FETCH_INTERVAL) {
        return;
      }
    }

    setLoading(true);
    lastFetchTimeRef.current = Date.now();

    // Store address at time of fetch to prevent race conditions
    const fetchAddress = address;
    
    // Create promise function
    const createFetchPromise = () => {
      const promise = (async () => {
        try {
          const results = await publicClient.multicall({
            contracts: [
              {
                address: PIXOTCHI_TOKEN_ADDRESS,
                abi: ERC20_BALANCE_ABI,
                functionName: 'balanceOf',
                args: [fetchAddress],
              },
              {
                address: LEAF_CONTRACT_ADDRESS,
                abi: leafAbi,
                functionName: 'balanceOf',
                args: [fetchAddress],
              },
            ],
            allowFailure: true,
          });

          const [seedResult, leafResult] = results;

          // Only update state if address hasn't changed during fetch
          if (lastAddressRef.current === fetchAddress) {
            setSeedBalance(seedResult.status === 'success' ? (seedResult.result as bigint) : BigInt(0));
            setLeafBalance(leafResult.status === 'success' ? (leafResult.result as bigint) : BigInt(0));
          }

        } catch (error) {
          console.error("Failed to fetch balances via multicall:", error);
          // Only update state if address hasn't changed during fetch
          if (lastAddressRef.current === fetchAddress) {
            setSeedBalance(BigInt(0));
            setLeafBalance(BigInt(0));
          }
        } finally {
          // Only update loading if address hasn't changed during fetch
          if (lastAddressRef.current === fetchAddress) {
            setLoading(false);
            // Clear pending request if address still matches (this is the current request)
            pendingRequestRef.current = null;
          }
        }
      })();
      return promise;
    };

    const fetchPromise = createFetchPromise();
    pendingRequestRef.current = fetchPromise;
    return fetchPromise;
  }, [address, publicClient]);

  // Debounced refresh function for external calls (user-initiated rapid refreshes)
  const debouncedRefresh = useRef(
    debounce(() => {
      fetchBalances(false, false); // Use throttling for user-initiated refreshes
    }, 300)
  ).current;

  // Immediate refresh function for transaction-triggered events (bypasses throttling)
  const immediateRefresh = useCallback(() => {
    // Small delay to allow blockchain state to propagate after transaction
    setTimeout(() => {
      fetchBalances(true, false); // Bypass throttling for transaction-triggered refreshes
    }, 500);
  }, [fetchBalances]);

  // Track address and connection changes - fetch immediately on login/connection
  useEffect(() => {
    let mounted = true;
    const previousAddress = lastAddressRef.current;
    const currentAddress = address;
    const previousConnected = lastConnectedRef.current;
    const currentConnected = isConnected;
    
    // Detect login: address changes from null to address OR isConnected changes from false to true
    const justLoggedIn = (previousAddress !== currentAddress && currentAddress && currentConnected) ||
                         (!previousConnected && currentConnected && currentAddress);
    
    // Detect logout: address becomes null OR isConnected becomes false
    const justLoggedOut = (previousAddress && !currentAddress) ||
                         (previousConnected && !currentConnected);
    
    // Update refs
    lastAddressRef.current = currentAddress;
    lastConnectedRef.current = currentConnected;
    

    if (currentAddress && currentConnected && publicClient) {
      if (justLoggedIn) {
        // User just logged in - force immediate fetch with no throttling or deduplication
        // Clear any pending request first to ensure fresh fetch
        pendingRequestRef.current = null;
        lastFetchTimeRef.current = 0; // Reset throttle timer
        
        // Fetch immediately with force=true to bypass all limits
        fetchBalances(true, true);
        

        const retryTimeoutId1 = setTimeout(() => {
          // Guard against concurrent requests and unmount
          if (!mounted) return;
          if (lastAddressRef.current && lastConnectedRef.current && publicClient) {
            // Check if another fetch is already in progress before retrying
            if (pendingRequestRef.current) {
              return; // Skip retry if fetch is ongoing
            }
            pendingRequestRef.current = null;
            fetchBalances(true, true);
          }
        }, 500);
        
        const retryTimeoutId2 = setTimeout(() => {
          // Guard against concurrent requests and unmount
          if (!mounted) return;
          if (lastAddressRef.current && lastConnectedRef.current && publicClient) {
            // Check if another fetch is already in progress before retrying
            if (pendingRequestRef.current) {
              return; // Skip retry if fetch is ongoing
            }
            pendingRequestRef.current = null;
            fetchBalances(true, true);
          }
        }, 1500);
        
        return () => {
          mounted = false;
          clearTimeout(retryTimeoutId1);
          clearTimeout(retryTimeoutId2);
        };
      } else {

        if (!pendingRequestRef.current) {
          fetchBalances(true, false); // bypassThrottle but allow deduplication
        }
      }
    } else if (justLoggedOut || !currentAddress || !currentConnected) {
      // User logged out or not connected - reset balances immediately
      if (mounted) {
        setSeedBalance(BigInt(0));
        setLeafBalance(BigInt(0));
        setLoading(false);
      }
      // Clear pending request
      pendingRequestRef.current = null;
    }
    
    return () => {
      mounted = false;
    };
  }, [address, isConnected, publicClient, fetchBalances]);

  useEffect(() => {
    // Expose a safe global refresher for non-React callers (use debounced version for safety)
    try {
      (window as any).__pixotchi_refresh_balances__ = debouncedRefresh;
    } catch {}
    
    // Listen for transaction-triggered refresh events (use immediate refresh)
    const handleRefresh = () => {
      immediateRefresh();
    };
    
    window.addEventListener('balances:refresh', handleRefresh);
    return () => {
      window.removeEventListener('balances:refresh', handleRefresh);
      // Cleanup pending request on unmount
      pendingRequestRef.current = null;
    };
  }, [debouncedRefresh, immediateRefresh]);

  const value = {
    seedBalance,
    leafBalance,
    loading,
    refreshBalances: () => fetchBalances(true, false), // Direct calls bypass throttling but allow deduplication
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
