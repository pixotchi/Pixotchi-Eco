"use client";

import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { getEthQuoteForSeedAmount } from '@/lib/contracts';
import type { SeedPurchaseQuote } from '@/lib/swap/seed-purchase-quote';
import { useDebounce } from './useDebounce';

/** An amount-keyed quote prevents a previous quantity's price being submitted. */
export function useSeedPurchaseQuote(
  seedAmount: bigint,
  enabled: boolean,
  readQuote: (amount: bigint) => Promise<SeedPurchaseQuote> = getEthQuoteForSeedAmount,
  purchaseIdentity = '',
) {
  const debouncedAmount = useDebounce(seedAmount, 500);
  const debouncedIdentity = useDebounce(purchaseIdentity, 500);
  const requested = enabled && seedAmount > BigInt(0);
  const amountReady = seedAmount === debouncedAmount && purchaseIdentity === debouncedIdentity;
  const currentRequestRef = useRef({ seedAmount, purchaseIdentity, requested });
  currentRequestRef.current = { seedAmount, purchaseIdentity, requested };
  const query = useQuery({
    queryKey: ['seed-purchase-eth-quote', debouncedAmount.toString(), debouncedIdentity],
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
  const quote = requested && amountReady && !query.isError ? query.data ?? null : null;
  return {
    // Preserve the mounted transaction during a same-amount refresh. The caller
    // disables submission with isLoading until the refreshed quote arrives.
    quote,
    isLoading,
    error: requested && amountReady && query.isError ? query.error.message : null,
    retry: () => query.refetch(),
    /** Revalidate before signing. A changed price needs a new player review. */
    requireCurrentQuote: async () => {
      if (!quote || isLoading) throw new Error('Wait for the current ETH quote before continuing.');
      const refreshed = await query.refetch();
      const current = currentRequestRef.current;
      if (!current.requested || current.seedAmount !== seedAmount || current.purchaseIdentity !== purchaseIdentity) {
        throw new Error('The purchase changed. Review the new selection before continuing.');
      }
      if (refreshed.isError || !refreshed.data) {
        throw new Error('The ETH quote could not be verified. Retry the quote before continuing.');
      }
      if (refreshed.data.seedAmount !== quote.seedAmount || refreshed.data.ethAmountWithBuffer !== quote.ethAmountWithBuffer) {
        throw new Error('The ETH price changed. Review the updated quote and try again.');
      }
      return refreshed.data;
    },
  };
}
