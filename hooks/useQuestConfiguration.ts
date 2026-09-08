"use client";

import { useQuery } from '@tanstack/react-query';
import { LAND_CONTRACT_ADDRESS } from '@/lib/contracts';
import { questConfigurationIdentity } from '@/lib/quest-configuration';

import { readQuestConfiguration } from '@/lib/quest-configuration-read';
export { readQuestConfiguration } from '@/lib/quest-configuration-read';

export const QUEST_CONFIGURATION_QUERY_KEY = ['quest-configuration', LAND_CONTRACT_ADDRESS] as const;


export function useQuestConfiguration(read = readQuestConfiguration) {
  const query = useQuery({ queryKey: QUEST_CONFIGURATION_QUERY_KEY, queryFn: () => read(), staleTime: 60_000, retry: 1 });
  return { ...query, isReady: !!query.data && !query.isError,
    requireCurrent: async () => {
      if (!query.data || query.isError) throw new Error('Check the quest terms before starting.');
      const reviewed = questConfigurationIdentity(query.data);
      const fresh = await query.refetch({ throwOnError: true });
      if (!fresh.data || questConfigurationIdentity(fresh.data) !== reviewed) throw new Error('Quest terms changed. Review the updated duration and rewards before starting.');
    },
  };
}
