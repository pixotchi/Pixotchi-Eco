"use client";

import { useReadContracts } from "wagmi";
import { Address, erc20Abi } from "viem";

export function useTokenMetadata(tokenAddress: string | undefined | null) {
  const { data, isLoading } = useReadContracts({
    contracts: tokenAddress && tokenAddress !== "0x0000000000000000000000000000000000000000"
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
      enabled: !!tokenAddress && tokenAddress !== "0x0000000000000000000000000000000000000000",
      staleTime: Infinity,
    },
  });

  const symbol = (data?.[0]?.result as string | undefined) ?? undefined;
  const decimals = Number(data?.[1]?.result ?? 18);

  return {
    symbol,
    decimals,
    isLoading,
  };
}
