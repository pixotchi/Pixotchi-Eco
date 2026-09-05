"use client";
import { useQuery } from '@tanstack/react-query';
import { parseRocksRanking, parseStakeRanking } from '@/lib/ranking-response';

export type RankingReader = (signal: AbortSignal) => Promise<unknown>;
const readRanking = (path: string): RankingReader => async signal => {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`Ranking unavailable (${response.status})`);
  return response.json() as Promise<unknown>;
};
const readStake = readRanking('/api/leaderboard/stake');
const readRocks = readRanking('/api/leaderboard/rocks');

/** Public rankings have separate lifetimes, cancellation, validation and error states. */
export function useStakeLeaderboard({ enabled, read = readStake }: { enabled: boolean; read?: RankingReader }) {
  const query = useQuery({ queryKey: ['leaderboard', 'stake'], enabled,
    queryFn: async ({ signal }) => parseStakeRanking(await read(signal)),
    staleTime: 24 * 60 * 60_000, gcTime: 24 * 60 * 60_000, retry: false });
  return { rows: query.isError ? [] : query.data ?? [], loading: query.isPending,
    error: query.isError ? 'Stake rankings could not be loaded. Please try again.' : null, refresh: query.refetch };
}

export function useRocksLeaderboard({ enabled, disabledMessage, read = readRocks }: {
  enabled: boolean; disabledMessage?: string; read?: RankingReader;
}) {
  const query = useQuery({ queryKey: ['leaderboard', 'rocks'], enabled: enabled && !disabledMessage,
    queryFn: async ({ signal }) => parseRocksRanking(await read(signal)),
    staleTime: 5 * 60_000, gcTime: 10 * 60_000, retry: false });
  const disabledNotice = disabledMessage ?? (!query.isError && query.data?.disabled ? query.data.message : null);
  return { rows: disabledNotice || query.isError ? [] : query.data?.rows ?? [],
    loading: !disabledNotice && query.isPending,
    disabledNotice, error: !disabledNotice && query.isError ? 'Rocks rankings could not be loaded. Please try again.' : null,
    refresh: query.refetch };
}
