'use client';

import { useQuery } from '@tanstack/react-query';
import { getLandsByOwner, getPlantsByOwner, getStakeInfo } from '@/lib/contracts';
import { fetchEfpStats } from '@/lib/efp-service';

/** Each independent group can fail and recover without hiding the others. */
export function useProfileStats(owner: string | null, open: boolean, socialRevision: number) {
  const identity = owner?.toLowerCase();
  const options = { enabled: Boolean(owner) && open, staleTime: 120_000, retry: false };
  const plants = useQuery({ ...options, queryKey: ['profile-plants', identity], queryFn: async () => (await getPlantsByOwner(owner!)).length });
  const lands = useQuery({ ...options, queryKey: ['profile-lands', identity], queryFn: async () => (await getLandsByOwner(owner!)).length });
  const stake = useQuery({ ...options, queryKey: ['profile-stake', identity], queryFn: async () => {
    const value = await getStakeInfo(owner!);
    if (!value || typeof value.staked !== 'bigint') throw new Error('Staked SEED unavailable');
    return value.staked;
  } });
  const social = useQuery({ ...options, queryKey: ['efpStats', identity, socialRevision], queryFn: async () => {
    const value = await fetchEfpStats(owner!);
    if (!value || !Number.isFinite(value.followersCount) || !Number.isFinite(value.followingCount)) throw new Error('Social counts unavailable');
    return value;
  } });
  return { plants, lands, stake, social };
}
