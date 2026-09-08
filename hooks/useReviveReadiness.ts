'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { checkTokenApproval, getRevivePrice, getTokenBalance } from '@/lib/contracts';

export function useReviveReadiness(owner: `0x${string}` | undefined, plantId: number | null, enabled: boolean) {
  const identity = `${owner?.toLowerCase()}:${plantId}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const options = { enabled: enabled && Boolean(owner) && plantId !== null, retry: false };
  const price = useQuery({ ...options, queryKey: ['revive-read', identity, 'price'], queryFn: async () => {
    const value = await getRevivePrice();
    if (value < BigInt(0)) throw new Error('Invalid revive price');
    return value;
  } });
  const balance = useQuery({ ...options, queryKey: ['revive-read', identity, 'balance'], queryFn: () => getTokenBalance(owner!) });
  const allowance = useQuery({ ...options, queryKey: ['revive-read', identity, 'allowance'], queryFn: () => checkTokenApproval(owner!) });
  const ready = [price, balance, allowance].every(query => query.data !== undefined && !query.isError);
  const requireCurrent = async () => {
    if (!ready) throw new Error('Verify revive price, balance, and spending permission first.');
    const [freshPrice, freshBalance, freshAllowance] = await Promise.all([price.refetch(), balance.refetch(), allowance.refetch()]);
    if (currentIdentity.current !== identity) throw new Error('The selected plant or wallet changed.');
    if ([freshPrice, freshBalance, freshAllowance].some(query => query.isError || query.data === undefined)) throw new Error('Revive data could not be verified. Retry the failed read.');
    if (freshPrice.data !== price.data) throw new Error('The revive price changed. Review it before continuing.');
    if (freshBalance.data! < freshPrice.data!) throw new Error('Your current SEED balance is too low.');
  };
  return { price, balance, allowance, ready, requireCurrent };
}
