"use client";

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getLandLeaderboard, getLandSupply, LandLeaderboardEntry } from '@/lib/contracts';
import { queryKeys } from '@/lib/query-keys';
import { Land } from '@/lib/types';

const MAP_DATA_STALE_TIME_MS = 60_000;

/**
 * Supply + neighbour metadata for the land map.
 *
 * This used to keep its cache in module-level `let`s (`cachedLeaderboard`,
 * `lastFetchTime`, `fetchPending`). Those outlived every wallet switch and
 * remount, could not be invalidated after a mint, and hand-rolled the request
 * deduplication that React Query already provides.
 *
 * `getLandLeaderboard` reads every minted plot in one range call, and the result
 * is only ever rendered inside the map modal, so it is gated on the modal
 * actually being open. Supply stays eager: it is a single cheap read and it is
 * what the map header shows first.
 */
export function useLandMap(userLands: Land[], { enabled = true }: { enabled?: boolean } = {}) {
  const supplyQuery = useQuery({
    queryFn: getLandSupply,
    queryKey: queryKeys.landSupply(),
    staleTime: MAP_DATA_STALE_TIME_MS,
  });

  const leaderboardQuery = useQuery({
    enabled,
    queryFn: () => getLandLeaderboard(),
    queryKey: queryKeys.landLeaderboard(),
    staleTime: MAP_DATA_STALE_TIME_MS,
  });

  const totalSupply = useMemo(() => {
    const supply = supplyQuery.data?.totalSupply;
    if (typeof supply === 'number' && supply > 0) return supply;
    // Without a supply read the map still needs an upper bound wide enough to
    // contain every plot the player owns.
    const maxUserTokenId = userLands.reduce(
      (max, land) => Math.max(max, Number(land.tokenId)),
      0,
    );
    return supplyQuery.isError ? Math.max(500, maxUserTokenId) : 0;
  }, [supplyQuery.data?.totalSupply, supplyQuery.isError, userLands]);

  const neighborData = useMemo(() => {
    const map: Record<number, LandLeaderboardEntry> = {};
    for (const entry of leaderboardQuery.data ?? []) {
      map[entry.landId] = entry;
    }
    return map;
  }, [leaderboardQuery.data]);

  return {
    isLoading: supplyQuery.isPending || (enabled && leaderboardQuery.isPending),
    neighborData,
    totalSupply,
  };
}
