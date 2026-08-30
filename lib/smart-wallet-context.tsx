"use client";

import { createContext, useContext, ReactNode, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAccount, usePublicClient } from "wagmi";

export type SmartWalletType =
  | 'coinbase-smart'
  | 'other-smart'
  | 'eip7702-delegated'
  | 'eoa'
  | 'UntypedValue';

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

type OwnedSmartWalletDetection = {
  ownerKey: string | null;
  value: SmartWalletDetection;
};

function createEmptyDetection(isLoading = false): SmartWalletDetection {
  return {
    isSmartWallet: false,
    walletType: 'UntypedValue',
    capabilities: null,
    detectionMethods: [],
    isContract: false,
    hasCode: false,
    delegationTarget: null,
    isDelegatedEoa: false,
    isLoading,
    lastChecked: null,
  };
}

export function SmartWalletProvider({ children }: { children: ReactNode }) {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const detectionChainId = chainId ?? publicClient?.chain?.id ?? null;
  const ownerKey = address && isConnected
    ? `${detectionChainId ?? 'unknown'}:${address.toLowerCase()}`
    : null;
  const ownerKeyRef = useRef(ownerKey);
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  ownerKeyRef.current = ownerKey;

  const [detectionSnapshot, setDetectionSnapshot] = useState<OwnedSmartWalletDetection>({
    ownerKey: null,
    value: createEmptyDetection(),
  });

  // Gate the rendered value as well as async commits. Effects run after paint, so
  // clearing only inside the address-change effect still exposed the previous
  // wallet's routing classification for one render.
  const detection = useMemo(
    () => detectionSnapshot.ownerKey === ownerKey
      ? detectionSnapshot.value
      : createEmptyDetection(Boolean(ownerKey)),
    [detectionSnapshot, ownerKey],
  );

  const getAddressBytecode = useCallback(async (addr: string): Promise<`0x${string}` | undefined> => {
    if (!publicClient) {
      throw new Error('Public client is not ready');
    }
    return await publicClient.getBytecode({ address: addr as `0x${string}` });
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
  const detectSmartWallet = useCallback(async (requestedAddress: string): Promise<SmartWalletDetection> => {
    // console.log('🔍 Starting comprehensive smart wallet detection (4-tier approach) for:', requestedAddress);

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
      const code = await getAddressBytecode(requestedAddress);
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
        walletType: 'UntypedValue',
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
  }, [getAddressBytecode, parseEip7702DelegationTarget]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, []);

  // Run detection when wallet connects or changes
  useEffect(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;

    if (!address || !ownerKey) {
      setDetectionSnapshot({ ownerKey: null, value: createEmptyDetection() });
      return;
    }

    const requestedOwnerKey = ownerKey;
    const requestedAddress = address;
    setDetectionSnapshot({
      ownerKey: requestedOwnerKey,
      value: createEmptyDetection(true),
    });

    void detectSmartWallet(requestedAddress).then((result) => {
      if (
        !mountedRef.current
        || requestGenerationRef.current !== generation
        || ownerKeyRef.current !== requestedOwnerKey
      ) {
        return;
      }
      setDetectionSnapshot({
        ownerKey: requestedOwnerKey,
        value: { ...result, isLoading: false },
      });
    });
  }, [address, detectSmartWallet, ownerKey]);

  // Manual refetch function
  const refetch = useCallback(async () => {
    const requestedOwnerKey = ownerKey;
    const requestedAddress = address;

    // A consumer can retain an older context callback across an account change.
    // Do not let that stale callback supersede the current owner's in-flight read.
    if (!mountedRef.current || ownerKeyRef.current !== requestedOwnerKey) return;

    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;

    if (!requestedAddress || !requestedOwnerKey) {
      if (mountedRef.current) {
        setDetectionSnapshot({ ownerKey: null, value: createEmptyDetection() });
      }
      return;
    }

    setDetectionSnapshot({
      ownerKey: requestedOwnerKey,
      value: createEmptyDetection(true),
    });
    const result = await detectSmartWallet(requestedAddress);
    if (
      !mountedRef.current
      || requestGenerationRef.current !== generation
      || ownerKeyRef.current !== requestedOwnerKey
    ) {
      return;
    }
    setDetectionSnapshot({
      ownerKey: requestedOwnerKey,
      value: { ...result, isLoading: false },
    });
  }, [address, detectSmartWallet, ownerKey]);

  // Memoized: the spread minted a fresh object per render, re-rendering the
  // heaviest consumers (tabs + the whole transactions family) on every parent
  // render and every useAccount tick.
  const value = useMemo(() => ({ ...detection, refetch }), [detection, refetch]);

  return (
    <SmartWalletContext.Provider value={value}>
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
