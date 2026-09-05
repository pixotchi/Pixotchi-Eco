"use client";
import { useQuery } from '@tanstack/react-query';
import { getLandLeaderboard } from '@/lib/contracts';
import { rankLands } from '@/lib/land-ranking';

/** Public Base ranking has its own cache/error state; a failed plant read cannot hide it. */
export function useLandLeaderboard({ enabled, read = getLandLeaderboard }: { enabled: boolean; read?: typeof getLandLeaderboard }) {
  const query = useQuery({ queryKey: ['leaderboard', 'lands', 8453], queryFn: () => read(), enabled,
    staleTime: 5 * 60_000, gcTime: 10 * 60_000, retry: false, select: rankLands });
  return { rows: query.isError ? [] : query.data ?? [], loading: query.isPending,
    error: query.isError ? 'Land rankings could not be loaded. Your lands have not changed.' : null, refresh: query.refetch };
}
