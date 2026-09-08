"use client";

import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getLandsByOwner, getPlantsByOwner, getReadClient, LAND_CONTRACT_ADDRESS } from '@/lib/contracts';
import { landAbi } from '@/public/abi/pixotchi-v3-abi';
import { casinoAbi } from '@/public/abi/casino-abi';
import { CLIENT_ENV } from '@/lib/env-config';
import { readBuildingProduction } from '@/lib/land-production';
import { readBoolean, readTupleField } from '@/lib/contract-value';
import { onOwnerResourceInvalidation, ownerInvalidationMatches } from '@/lib/owner-resource-invalidation';
import { queryKeys } from '@/lib/query-keys';
import type { MissionAssets, MissionBuilding, MissionLandState, MissionRead } from '@/lib/mission-actions';
import type { BuildingType } from '@/lib/types';

const ready = <T,>(data: T): MissionRead<T> => ({ status: 'ready', data });

function buildingRead(value: unknown, type: BuildingType): MissionRead<readonly MissionBuilding[]> {
  try {
    if (!Array.isArray(value)) throw new Error('Invalid buildings');
    return ready(value.map(building => ({
      ...readBuildingProduction(building, type),
      isUpgrading: readBoolean(readTupleField(building, 'isUpgrading', type === 'village' ? 7 : 5)),
    })));
  } catch { return { status: 'error' }; }
}

/** Casino uses its own facet. A failed casino read cannot safely mean "not built". */
async function readMissionFarms(landIds: readonly string[], signal: AbortSignal, blockNumber?: bigint): Promise<MissionLandState[]> {
  const client = getReadClient();
  const farms: MissionLandState[] = [];
  for (let offset = 0; offset < landIds.length; offset += 15) {
    signal.throwIfAborted();
    const ids = landIds.slice(offset, offset + 15);
    const calls = ids.flatMap(id => [
      { address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'villageGetVillageBuildingsByLandId' as const, args: [BigInt(id)] as const },
      { address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'townGetBuildingsByLandId' as const, args: [BigInt(id)] as const },
      { address: LAND_CONTRACT_ADDRESS, abi: casinoAbi, functionName: 'casinoIsBuilt' as const, args: [BigInt(id)] as const },
    ]);
    try {
      const results = await client.multicall({ allowFailure: true, contracts: calls, blockNumber });
      signal.throwIfAborted();
      ids.forEach((landId, index) => {
        const [village, town, casino] = results.slice(index * 3, index * 3 + 3);
        farms.push({
          landId,
          village: village?.status === 'success' ? buildingRead(village.result, 'village') : { status: 'error' },
          town: town?.status === 'success' ? buildingRead(town.result, 'town') : { status: 'error' },
          casino: casino?.status === 'success' && typeof casino.result === 'boolean' ? ready(casino.result) : { status: 'error' },
        });
      });
    } catch (error) {
      if (signal.aborted) throw error;
      // Keep other chunks useful; only an authoritative negative permits a build prompt.
      ids.forEach(landId => farms.push({ landId, village: { status: 'error' }, town: { status: 'error' }, casino: { status: 'error' } }));
    }
  }
  return farms;
}

function queryRead<T>(query: { data: T | undefined; isError: boolean; isFetching: boolean; isPending: boolean }): MissionRead<T> {
  if (query.isFetching || query.isPending) return { status: 'loading' };
  if (query.isError || query.data === undefined) return { status: 'error' };
  return ready(query.data);
}

/** Shares owner list caches with Farm, but only reads availability while Tasks is open. */
export function useMissionAssets(owner: string | null, enabled: boolean) {
  const normalizedOwner = owner?.toLowerCase() ?? null;
  const active = enabled && Boolean(normalizedOwner);
  const client = useQueryClient();
  const receiptBoundaries = useRef(new Map<string, bigint>());
  const options = { enabled: active, staleTime: 0, retry: false as const, refetchOnWindowFocus: true };
  const lands = useQuery({
    ...options,
    queryKey: queryKeys.landsByOwner(normalizedOwner),
    queryFn: () => getLandsByOwner(normalizedOwner!),
    meta: { ownerResourceRead: (readOptions?: { blockNumber?: bigint }) => getLandsByOwner(normalizedOwner!, undefined, readOptions?.blockNumber) },
  });
  const plants = useQuery({
    ...options,
    queryKey: queryKeys.plantsByOwner(normalizedOwner),
    queryFn: () => getPlantsByOwner(normalizedOwner!),
    meta: { ownerResourceRead: (readOptions?: { blockNumber?: bigint }) => getPlantsByOwner(normalizedOwner!, undefined, readOptions?.blockNumber) },
  });
  const landIds = (lands.data ?? []).map(land => land.tokenId.toString()).sort();
  const farmQueryKey = ['missionFarm', normalizedOwner, ...landIds];
  const farms = useQuery({
    ...options,
    queryKey: farmQueryKey,
    queryFn: ({ signal }) => readMissionFarms(landIds, signal),
    enabled: active && lands.isSuccess && !lands.isFetching && landIds.length > 0,
  });

  useEffect(() => {
    if (!active || !normalizedOwner) return;
    return onOwnerResourceInvalidation(async detail => {
      const landChanged = ownerInvalidationMatches(detail, normalizedOwner, 'lands');
      const plantChanged = ownerInvalidationMatches(detail, normalizedOwner, 'plants');
      const buildingsChanged = ownerInvalidationMatches(detail, normalizedOwner, 'buildings');
      if (!landChanged && !plantChanged && !buildingsChanged) return;
      const farmKey = ['missionFarm', normalizedOwner];
      if (detail.clear) {
        const keys = [farmKey, ...(landChanged ? [queryKeys.landsByOwner(normalizedOwner)] : []),
          ...(plantChanged ? [queryKeys.plantsByOwner(normalizedOwner)] : [])];
        await Promise.all(keys.map(queryKey => client.cancelQueries({ queryKey })));
        keys.forEach(queryKey => client.removeQueries({ queryKey }));
        receiptBoundaries.current.delete(normalizedOwner);
        return;
      }
      if (detail.receiptBlock !== undefined) {
        const block = BigInt(detail.receiptBlock);
        const previous = receiptBoundaries.current.get(normalizedOwner) ?? BigInt(0);
        receiptBoundaries.current.set(normalizedOwner, block > previous ? block : previous);
      }
      const boundary = detail.receiptBlock === undefined ? undefined : receiptBoundaries.current.get(normalizedOwner);
      const refreshList = async (domain: 'lands' | 'plants') => {
        const queryKey = domain === 'lands' ? queryKeys.landsByOwner(normalizedOwner) : queryKeys.plantsByOwner(normalizedOwner);
        await client.invalidateQueries({ queryKey, exact: true, refetchType: 'none' });
        // fetchQuery deduplicates without cancelling Farm's stronger receipt/invariant reconciliation.
        const refreshOptions = {
          queryKey,
          staleTime: 0, retry: false as const,
        };
        if (domain === 'lands') await client.fetchQuery({ ...refreshOptions,
          queryFn: () => getLandsByOwner(normalizedOwner, undefined, boundary),
          meta: { ownerResourceRead: (readOptions?: { blockNumber?: bigint }) => getLandsByOwner(normalizedOwner, undefined, readOptions?.blockNumber) },
        });
        else await client.fetchQuery({ ...refreshOptions,
          queryFn: () => getPlantsByOwner(normalizedOwner, undefined, boundary),
          meta: { ownerResourceRead: (readOptions?: { blockNumber?: bigint }) => getPlantsByOwner(normalizedOwner, undefined, readOptions?.blockNumber) },
        });
      };
      await Promise.allSettled([
        ...(landChanged ? [refreshList('lands')] : []),
        ...(plantChanged ? [refreshList('plants')] : []),
      ]);
      if (landChanged || buildingsChanged) {
        // This query belongs only to Tasks, so replacing a stale in-flight read is safe.
        await client.cancelQueries({ queryKey: farmKey });
        await client.invalidateQueries({ queryKey: farmKey, refetchType: 'none' });
        const latestLands = client.getQueryData<Awaited<ReturnType<typeof getLandsByOwner>>>(queryKeys.landsByOwner(normalizedOwner));
        const ids = (latestLands ?? []).map(land => land.tokenId.toString()).sort();
        if (ids.length) await client.fetchQuery({
          queryKey: [...farmKey, ...ids],
          queryFn: ({ signal }) => readMissionFarms(ids, signal,
            detail.receiptBlock === undefined ? undefined : receiptBoundaries.current.get(normalizedOwner)),
          staleTime: 0, retry: false,
        });
      }
    });
  }, [active, client, normalizedOwner]);

  const retry = useCallback(() => {
    if (!active) return;
    void client.invalidateQueries({ queryKey: queryKeys.landsByOwner(normalizedOwner), exact: true }, { cancelRefetch: false });
    void client.invalidateQueries({ queryKey: queryKeys.plantsByOwner(normalizedOwner), exact: true }, { cancelRefetch: false });
    void client.invalidateQueries({ queryKey: ['missionFarm', normalizedOwner] });
  }, [active, client, normalizedOwner]);

  const assets: MissionAssets = {
    owner: normalizedOwner,
    lands: queryRead(lands),
    plants: queryRead(plants),
    farms: landIds.length ? queryRead(farms) : ready([]),
    casinoEnabled: CLIENT_ENV.CASINO_ENABLED,
  };
  return { assets, retry };
}
