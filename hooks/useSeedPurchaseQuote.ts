"use client";

import { useQuery } from '@tanstack/react-query';
import { getEthQuoteForSeedAmount } from '@/lib/contracts';
import type { SeedPurchaseQuote } from '@/lib/swap/seed-purchase-quote';
import { useDebounce } from './useDebounce';

/** An amount-keyed quote prevents a previous quantity's price being submitted. */
export function useSeedPurchaseQuote(
  seedAmount: bigint,
  enabled: boolean,
  readQuote: (amount: bigint) => Promise<SeedPurchaseQuote> = getEthQuoteForSeedAmount,
) {
  const debouncedAmount = useDebounce(seedAmount, 500);
  const requested = enabled && seedAmount > BigInt(0);
  const amountReady = seedAmount === debouncedAmount;
  const query = useQuery({
    queryKey: ['seed-purchase-eth-quote', debouncedAmount.toString()],
    enabled: requested && amountReady,
    queryFn: async () => {
      const result = await readQuote(debouncedAmount);
      if (result.error || result.ethAmountWithBuffer <= BigInt(0) || result.seedAmount !== debouncedAmount) {
        throw new Error(result.error || 'Unable to quote this purchase');
      }
      return result;
    },
    staleTime: 15_000,
    gcTime: 60_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const isLoading = requested && (!amountReady || query.isPending || query.isFetching);
  return {
    // Preserve the mounted transaction during a same-amount refresh. The caller
    // disables submission with isLoading until the refreshed quote arrives.
    quote: requested && amountReady && !query.isError ? query.data ?? null : null,
    isLoading,
    error: requested && amountReady && query.isError ? query.error.message : null,
    retry: () => query.refetch(),
  };
}
