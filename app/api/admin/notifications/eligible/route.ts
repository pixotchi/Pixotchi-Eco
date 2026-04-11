import { NextRequest, NextResponse } from 'next/server';
import { differenceInSeconds } from 'date-fns';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';
import { redis } from '@/lib/redis';
import { SERVER_ENV } from '@/lib/env-config';
import { getPlantsByOwner } from '@/lib/contracts';
import {
  NEYNAR_ENABLED_FIDS_CACHE_KEY,
  NEYNAR_ENABLED_FIDS_CACHE_TTL_SECONDS,
  PLANT_CARE_THRESHOLD_SECONDS,
  getPlantCarePlantThrottleKey,
  getPlantCareUserThrottleKey,
} from '@/lib/notifications/constants';
import { collectDuePlantsByOwner } from '@/lib/notifications/plant-care';
import { getCurrentBaseAudienceAddresses, getCurrentBaseAudienceSnapshotMeta } from '@/lib/notifications/storage';
import { normalizeWalletAddress } from '@/lib/notifications/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function getThrottleState(key: string): Promise<boolean> {
  if (!redis) {
    return false;
  }

  return Boolean(await (redis as any)?.get?.(key));
}

async function fetchEnabledFids(): Promise<number[]> {
  const apiKey = SERVER_ENV.NEYNAR_API_KEY;
  if (!apiKey) return [];

  if (redis) {
    try {
      const cached = await redis.get(NEYNAR_ENABLED_FIDS_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(typeof cached === 'string' ? cached : JSON.stringify(cached));
        if (Array.isArray(parsed)) {
          return parsed.map((value) => Number(value)).filter((value) => Number.isFinite(value));
        }
      }
    } catch {
      // Ignore cache failures
    }
  }

  const allFids: number[] = [];
  let cursor: string | null = null;

  do {
    const url = new URL('https://api.neynar.com/v2/farcaster/frame/notification_tokens/');
    url.searchParams.set('limit', '100');
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const response = await fetch(url.toString(), {
      headers: { 'x-api-key': apiKey },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`Neynar API error (${response.status})`);
    }

    const payload = await response.json();
    const tokens: Array<{ fid: number }> | undefined = payload?.notification_tokens;
    if (tokens?.length) {
      for (const token of tokens) {
        if (!allFids.includes(token.fid)) {
          allFids.push(token.fid);
        }
      }
    }

    cursor = payload?.next?.cursor || null;
  } while (cursor);

  if (redis && allFids.length > 0) {
    await redis.set(NEYNAR_ENABLED_FIDS_CACHE_KEY, JSON.stringify(allFids), {
      ex: NEYNAR_ENABLED_FIDS_CACHE_TTL_SECONDS,
    });
  }

  return allFids;
}

async function resolveFidAddress(fid: number): Promise<string | null> {
  try {
    const cached = await (redis as any)?.get?.(`fidmap:${fid}`);
    if (cached) {
      return String(cached).toLowerCase();
    }

    const response = await fetch(`https://api.farcaster.xyz/fc/primary-address?fid=${fid}&protocol=ethereum`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const address = normalizeWalletAddress(payload?.result?.address?.address);
    if (address) {
      await (redis as any)?.set?.(`fidmap:${fid}`, address);
    }
    return address;
  } catch {
    return null;
  }
}

async function handleBaseEligible(request: NextRequest) {
  const url = new URL(request.url);
  const addressFilter = normalizeWalletAddress(url.searchParams.get('address'));
  const offset = Number.parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = Math.min(Number.parseInt(url.searchParams.get('limit') || '200', 10), 1000);

  const snapshotMeta = await getCurrentBaseAudienceSnapshotMeta();
  if (!snapshotMeta) {
    return NextResponse.json(createErrorResponse('Base audience snapshot missing', 503).body, { status: 503 });
  }

  const enabledSet = new Set(await getCurrentBaseAudienceAddresses());
  const dueOwners = await collectDuePlantsByOwner();
  const eligibleOwners = dueOwners.filter((owner) => enabledSet.has(owner.address));
  const filteredOwners = addressFilter
    ? eligibleOwners.filter((owner) => owner.address === addressFilter)
    : eligibleOwners;

  let throttledUsers = 0;
  let throttledPlants = 0;
  let wouldNotify = 0;

  const rows = await Promise.all(
    filteredOwners.map(async (owner) => {
      const userThrottled = await getThrottleState(getPlantCareUserThrottleKey('base', owner.address));
      const plants = await Promise.all(
        owner.duePlants.map(async (plant) => {
          const throttled = await getThrottleState(getPlantCarePlantThrottleKey('base', owner.address, plant.id));
          return {
            id: plant.id,
            hoursLeft: plant.hoursLeft,
            eligible: true,
            throttled,
          };
        }),
      );

      const throttledPlantCount = plants.filter((plant) => plant.throttled).length;
      throttledPlants += throttledPlantCount;
      if (userThrottled) {
        throttledUsers += 1;
      } else if (plants.some((plant) => !plant.throttled)) {
        wouldNotify += 1;
      }

      return {
        address: owner.address,
        userThrottled,
        plants,
      };
    }),
  );

  const paginated = rows.slice(offset, offset + limit);

  return NextResponse.json({
    success: true,
    provider: 'base',
    thresholdHours: 12,
    snapshot: snapshotMeta,
    pagination: {
      total: rows.length,
      offset,
      limit,
      returned: paginated.length,
      hasMore: offset + limit < rows.length,
    },
    summary: {
      addressesChecked: filteredOwners.length,
      addressesWithEligiblePlants: rows.length,
      totalEligiblePlants: rows.reduce((total, row) => total + row.plants.length, 0),
      throttledUsers,
      throttledPlants,
      wouldNotify,
    },
    eligible: paginated,
  });
}

async function handleNeynarEligible(request: NextRequest) {
  const url = new URL(request.url);
  const targetFid = url.searchParams.get('fid') ? Number.parseInt(url.searchParams.get('fid') || '0', 10) : undefined;
  const offset = Number.parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = Math.min(Number.parseInt(url.searchParams.get('limit') || '200', 10), 1000);
  const now = new Date();

  const allFids = targetFid ? [targetFid] : await fetchEnabledFids();
  const rows = [];
  let fidsWithAddress = 0;
  let fidsWithPlants = 0;
  let throttledUsers = 0;
  let throttledPlants = 0;
  let wouldNotify = 0;

  for (const fid of allFids) {
    const address = await resolveFidAddress(fid);
    if (!address) {
      continue;
    }

    fidsWithAddress += 1;
    const plants = await getPlantsByOwner(address);
    if (!plants?.length) {
      continue;
    }

    fidsWithPlants += 1;
    const eligiblePlants = [];

    for (const plant of plants) {
      const secondsLeft = differenceInSeconds(new Date(Number(plant.timeUntilStarving || 0) * 1000), now);
      if (secondsLeft <= 0 || secondsLeft > PLANT_CARE_THRESHOLD_SECONDS) {
        continue;
      }

      const throttled = await getThrottleState(getPlantCarePlantThrottleKey('neynar', fid, Number(plant.id)));
      if (throttled) {
        throttledPlants += 1;
      }

      eligiblePlants.push({
        id: Number(plant.id),
        hoursLeft: Math.round((secondsLeft / 3600) * 100) / 100,
        eligible: true,
        throttled,
      });
    }

    if (eligiblePlants.length === 0) {
      continue;
    }

    const userThrottled = await getThrottleState(getPlantCareUserThrottleKey('neynar', fid));
    if (userThrottled) {
      throttledUsers += 1;
    } else if (eligiblePlants.some((plant) => !plant.throttled)) {
      wouldNotify += 1;
    }

    rows.push({
      fid,
      address,
      userThrottled,
      plants: eligiblePlants,
    });
  }

  const paginated = rows.slice(offset, offset + limit);

  return NextResponse.json({
    success: true,
    provider: 'neynar',
    thresholdHours: 12,
    pagination: {
      total: rows.length,
      offset,
      limit,
      returned: paginated.length,
      hasMore: offset + limit < rows.length,
    },
    summary: {
      fidsChecked: allFids.length,
      fidsWithAddress,
      fidsWithPlants,
      fidsWithEligiblePlants: rows.length,
      totalEligiblePlants: rows.reduce((total, row) => total + row.plants.length, 0),
      throttledUsers,
      throttledPlants,
      wouldNotify,
    },
    eligible: paginated,
  });
}

export async function GET(request: NextRequest) {
  if (!validateAdminKey(request)) {
    return NextResponse.json(createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED').body, { status: 401 });
  }

  try {
    if (SERVER_ENV.NOTIFICATION_PROVIDER === 'base') {
      return handleBaseEligible(request);
    }

    return handleNeynarEligible(request);
  } catch (error) {
    return NextResponse.json(
      createErrorResponse(error instanceof Error ? error.message : 'Failed', 500).body,
      { status: 500 },
    );
  }
}
