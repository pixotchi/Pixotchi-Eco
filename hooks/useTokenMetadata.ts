"use client";

import { useReadContracts } from "wagmi";
import { Address, erc20Abi, isAddress, zeroAddress } from "viem";
import { resolveTokenMetadata } from '@/lib/token-metadata-state';

export function useTokenMetadata(tokenAddress: string | undefined | null) {
  const enabled = Boolean(tokenAddress && isAddress(tokenAddress) && tokenAddress.toLowerCase() !== zeroAddress);
  const { data, isLoading, isError: queryFailed, error: queryError, refetch } = useReadContracts({
    contracts: enabled
      ? [
          {
            address: tokenAddress as Address,
            abi: erc20Abi,
            functionName: "symbol",
          },
          {
            address: tokenAddress as Address,
            abi: erc20Abi,
            functionName: "decimals",
          },
        ]
      : [],
    query: {
      enabled,
      staleTime: Infinity,
    },
  });

  const metadata = resolveTokenMetadata(enabled ? data : undefined, queryFailed);
  const isError = enabled && (queryFailed || (data !== undefined && !metadata.isReady));

  return {
    ...metadata,
    isLoading: enabled && isLoading,
    isError,
    error: isError ? queryError ?? new Error('Token details could not be verified.') : null,
    refetch,
  };
}
