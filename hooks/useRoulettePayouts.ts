"use client";

import { useReadContracts } from 'wagmi';
import { LAND_CONTRACT_ADDRESS } from '@/lib/contracts';
import { casinoAbi, type CasinoBetType } from '@/public/abi/casino-abi';

export function useRoulettePayouts(enabled: boolean) {
  const query = useReadContracts({
    contracts: Array.from({ length: 13 }, (_, type) => ({ address: LAND_CONTRACT_ADDRESS, abi: casinoAbi, functionName: 'casinoGetPayoutMultiplier' as const, args: [type] as const })),
    query: { enabled, staleTime: Infinity },
  });
  const payouts: Partial<Record<CasinoBetType, number>> = {};
  for (let type = 0; type < 13; type += 1) {
    const entry = query.data?.[type];
    if (entry?.status !== 'success' || typeof entry.result !== 'bigint' || entry.result < BigInt(0) || entry.result > BigInt(Number.MAX_SAFE_INTEGER)) break;
    payouts[type as CasinoBetType] = Number(entry.result);
  }
  const isReady = !query.isError && Object.keys(payouts).length === 13;
  return { payouts: isReady ? payouts as Record<CasinoBetType, number> : undefined, isReady, isError: query.isError || Boolean(query.data && !isReady), refetch: query.refetch };
}
