"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { canSettleQuestRewards, requireQuestRewardsReady } from '@/lib/quest-rewards-readiness';
import { QUEST_CONFIGURATION_QUERY_KEY } from './useQuestConfiguration';
import { validateQuestConfiguration, type QuestConfiguration } from '@/lib/quest-configuration';
import type { QuestRewardSources } from '@/lib/contracts';
import { readQuestRewardsSnapshot, type QuestRewardsSnapshot } from '@/lib/quest-rewards-read';
export type { QuestRewardsSnapshot } from '@/lib/quest-rewards-read';

const REWARDS_REFRESH_INTERVAL_MS = 30_000;

export type QuestRewardsAvailability = {
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  requireReady: (reviewedConfiguration?: QuestConfiguration) => Promise<void>;
  /** True once the pool has actually been read. Gate actions on this. */
  isReady: boolean;
  /** True when quests should be blocked because the reward pool cannot settle. */
  isUnavailable: boolean;
  leafAllowance: bigint;
  leafBalance: bigint;
  seedAllowance: bigint;
  seedBalance: bigint;
  sources: QuestRewardSources | null;
};


/**
 * Shared Farmer House reward-pool gate.
 *
 * Both the per-land quest panel and the batch send panel read through this so
 * they can never disagree about whether quests are runnable.
 */
export function useQuestRewardsAvailability(enabled: boolean = true, read: () => Promise<QuestRewardsSnapshot> = readQuestRewardsSnapshot): QuestRewardsAvailability {
  const queryClient = useQueryClient();
  const readSnapshot = useCallback(async () => {
    const snapshot = await read();
    validateQuestConfiguration(snapshot.configuration);
    queryClient.setQueryData(QUEST_CONFIGURATION_QUERY_KEY, snapshot.configuration);
    return snapshot;
  }, [queryClient, read]);
  const query = useQuery<QuestRewardsSnapshot>({
    enabled,
    gcTime: 5 * 60_000,
    queryFn: readSnapshot,
    queryKey: ["quest-rewards-availability"],
    refetchInterval: enabled ? REWARDS_REFRESH_INTERVAL_MS : false,
    staleTime: REWARDS_REFRESH_INTERVAL_MS,
  });

  const data = query.data;
  const seedBalance = data?.seedBalance ?? BigInt(0);
  const seedAllowance = data?.seedAllowance ?? BigInt(0);
  const leafBalance = data?.leafBalance ?? BigInt(0);
  const leafAllowance = data?.leafAllowance ?? BigInt(0);
  const { refetch } = query;
  const refresh = useCallback(async () => { await refetch(); }, [refetch]);
  const requireReady = useCallback((reviewedConfiguration?: QuestConfiguration) => requireQuestRewardsReady(async () => {
    const result = await refetch({ throwOnError: true });
    if (!result.data) throw new Error('Quest reward availability is missing.');
    return result.data;
  }, reviewedConfiguration), [refetch]);

  return {
    isLoading: query.isPending,
    isRefreshing: query.isFetching,
    error: query.error,
    refresh,
    requireReady,
    // Split "not read yet" from "read and insufficient" so the amber refilling
    // banner never flashes on a cold load, while callers still refuse to submit
    // until the pool is actually known. Submitting blind risks a revert.
    isReady: Boolean(data) && !query.isError,
    isUnavailable: data !== undefined && !query.isError && !canSettleQuestRewards(data),
    leafAllowance,
    leafBalance,
    seedAllowance,
    seedBalance,
    sources: data?.sources ?? null,
  };
}
