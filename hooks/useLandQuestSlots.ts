"use client";

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getQuestSlotsByLandId } from '@/lib/contracts';
import { queryKeys } from '@/lib/query-keys';
import type { QuestSlot } from '@/lib/quest-slots';

const EMPTY_SLOTS: readonly QuestSlot[] = Object.freeze([]);

export function landQuestQueryOptions(owner: string | null | undefined, chainId: number, landId: bigint | null, read = getQuestSlotsByLandId) {
  return {
    queryKey: queryKeys.questsByLand(owner, chainId, landId),
    queryFn: () => {
      if (!owner || landId === null) throw new Error('Choose a land to load quests.');
      return read(landId);
    },
    staleTime: 20_000,
    gcTime: 5 * 60_000,
  };
}

/** Query keys own isolation and deduplication. Only the overview polls; the
 * detail panel observes the same cache and explicitly refreshes after actions. */
export function useLandQuestSlots({ owner, chainId, landId, enabled = true, poll = false, read = getQuestSlotsByLandId }: {
  owner?: string | null; chainId: number; landId: bigint | null; enabled?: boolean; poll?: boolean;
  read?: typeof getQuestSlotsByLandId;
}) {
  const client = useQueryClient();
  const active = enabled && Boolean(owner) && landId !== null;
  const query = useQuery({
    ...landQuestQueryOptions(owner, chainId, landId, read),
    enabled: active,
    // The contract read already owns bounded retries; keep the explicit Retry
    // action reachable instead of multiplying those attempts here.
    retry: false,
    refetchInterval: active && poll ? 60_000 : false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });
  const refresh = useCallback(async (force = true): Promise<QuestSlot[] | null> => {
    if (!owner || landId === null) return null;
    try {
      return await client.fetchQuery({ ...landQuestQueryOptions(owner, chainId, landId, read), staleTime: force ? 0 : 2_000, retry: false });
    } catch { return null; }
  }, [chainId, client, landId, owner, read]);

  return {
    slots: active && !query.isError ? query.data ?? EMPTY_SLOTS : EMPTY_SLOTS,
    loading: active && query.isPending,
    error: active && query.isError ? 'We could not verify this land’s quests.' : null,
    ready: active && query.isSuccess,
    refresh,
  };
}
