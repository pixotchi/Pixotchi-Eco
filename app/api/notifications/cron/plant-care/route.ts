import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { differenceInSeconds } from 'date-fns';
import { redis } from '@/lib/redis';
import { CLIENT_ENV, SERVER_ENV } from '@/lib/env-config';
import { getPlantsByOwner } from '@/lib/contracts';
import {
  acquireBaseApiLock,
  getCurrentBaseAudienceAddresses,
  getCurrentBaseAudienceSnapshotMeta,
  recordPlantCareRun,
  releaseBaseApiLock,
} from '@/lib/notifications/storage';
import {
  BASE_PLANT_CARE_TARGET_PATH,
  BASE_REQUEST_LOCK_TTL_SECONDS,
  NEYNAR_ENABLED_FIDS_CACHE_KEY,
  NEYNAR_ENABLED_FIDS_CACHE_TTL_SECONDS,
  PLANT_CARE_THRESHOLD_SECONDS,
  PLANT_CARE_THROTTLE_SECONDS,
  getPlantCarePlantThrottleKey,
  getPlantCareUserThrottleKey,
} from '@/lib/notifications/constants';
import { collectDuePlantsByOwner, type DuePlantOwnerSummary } from '@/lib/notifications/plant-care';
import {
  sendBaseNotificationsInChunks,
  type BaseNotificationChunkedSendError,
  type BaseNotificationChunkedSendResponse,
} from '@/lib/notifications/base-api';
import { sleep, normalizeWalletAddress } from '@/lib/notifications/utils';
import { validateAdminKey } from '@/lib/auth-utils';
import { verifyVercelCron } from '@/lib/notifications/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 100;

const QuerySchema = z.object({
  debug: z.stringbool().optional(),
  dry: z.stringbool().optional(),
  fid: z.coerce.number().int().optional(),
  address: z.string().optional(),
});

type PublishBody = {
  target_fids: number[];
  notification: { title: string; body: string; target_url: string };
};

type NeynarFidProcessResult = {
  fid: number;
  address: string | null;
  userThrottled: boolean;
  dueCount: number;
  hasEligible: boolean;
  duePlants: Array<{ id: number; left: number; plantThrottled: boolean }>;
};

type BaseAddressProcessResult = {
  address: string;
  enabled: boolean;
  userThrottled: boolean;
  dueCount: number;
  hasEligible: boolean;
  duePlants: Array<{ id: number; hoursLeft: number; plantThrottled: boolean }>;
};

async function getThrottleState(key: string): Promise<boolean> {
  if (!redis) {
    return false;
  }

  return Boolean(await (redis as UntypedValue)?.get?.(key));
}

async function markThrottle(key: string): Promise<void> {
  if (!redis) {
    return;
  }

  await (redis as UntypedValue)?.set?.(key, '1', { ex: PLANT_CARE_THROTTLE_SECONDS });
}

async function clearThrottle(key: string): Promise<void> {
  if (!redis) {
    return;
  }

  await (redis as UntypedValue)?.del?.(key);
}

async function fetchAllEnabledFids(): Promise<number[]> {
  const apiKey = SERVER_ENV.NEYNAR_API_KEY;
  if (!apiKey) return [];

  if (redis) {
    try {
      const cached = await (redis as UntypedValue)?.get?.(NEYNAR_ENABLED_FIDS_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(typeof cached === 'string' ? cached : JSON.stringify(cached));
        if (Array.isArray(parsed)) {
          return parsed.map((value) => Number(value)).filter((value) => Number.isFinite(value));
        }
      }
    } catch {
      // Ignore cache parse failures and refetch
    }
  }

  const allFids: number[] = [];
  let cursor: string | null = null;
  let pageCount = 0;

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
    pageCount += 1;
  } while (cursor && pageCount < 100);

  if (redis && allFids.length > 0) {
    await (redis as UntypedValue)?.set?.(NEYNAR_ENABLED_FIDS_CACHE_KEY, JSON.stringify(allFids), {
      ex: NEYNAR_ENABLED_FIDS_CACHE_TTL_SECONDS,
    });
  }

  return allFids;
}

async function publishToFids(fids: number[], title: string, body: string) {
  if (fids.length === 0) {
    return { ok: true, json: null } as const;
  }

  const apiKey = SERVER_ENV.NEYNAR_API_KEY;
  if (!apiKey) {
    return { ok: false, json: { error: 'NEYNAR_API_KEY missing' } } as const;
  }

  const payload: PublishBody = {
    target_fids: fids,
    notification: { title, body, target_url: CLIENT_ENV.APP_URL },
  };

  const response = await fetch('https://api.neynar.com/v2/farcaster/frame/notifications/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  const json = await response.json().catch(() => ({}));

  return { ok: response.ok, json } as const;
}

async function resolveFidAddress(fid: number): Promise<string | null> {
  try {
    const cached = await (redis as UntypedValue)?.get?.(`fidmap:${fid}`);
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
      await (redis as UntypedValue)?.set?.(`fidmap:${fid}`, address);
    }
    return address;
  } catch {
    return null;
  }
}

async function processNeynarFid(
  fid: number,
  now: Date,
  debug: boolean,
  dryRun: boolean,
): Promise<NeynarFidProcessResult> {
  const address = await resolveFidAddress(fid);
  if (!address) {
    return { fid, address: null, userThrottled: false, dueCount: 0, hasEligible: false, duePlants: [] };
  }

  const plants = await getPlantsByOwner(address);
  const duePlants: Array<{ id: number; left: number; plantThrottled: boolean }> = [];

  if (!debug && !dryRun) {
    for (const plant of plants || []) {
      const left = differenceInSeconds(new Date(Number(plant.timeUntilStarving || 0) * 1000), now);
      if (left > PLANT_CARE_THRESHOLD_SECONDS) {
        await clearThrottle(getPlantCarePlantThrottleKey('neynar', fid, Number(plant.id)));
      }
    }
  }

  for (const plant of plants || []) {
    const left = differenceInSeconds(new Date(Number(plant.timeUntilStarving || 0) * 1000), now);
    if (left <= 0 || left > PLANT_CARE_THRESHOLD_SECONDS) {
      continue;
    }

    const plantThrottled =
      debug || dryRun
        ? false
        : await getThrottleState(getPlantCarePlantThrottleKey('neynar', fid, Number(plant.id)));

    duePlants.push({
      id: Number(plant.id),
      left,
      plantThrottled,
    });
  }

  const userThrottled =
    debug || dryRun ? false : await getThrottleState(getPlantCareUserThrottleKey('neynar', fid));

  return {
    fid,
    address,
    userThrottled,
    dueCount: duePlants.length,
    hasEligible: duePlants.some((plant) => !plant.plantThrottled),
    duePlants,
  };
}

async function handleNeynarPlantCare(req: NextRequest, debug: boolean, dryRun: boolean, targetFid?: number) {
  const startedAtMs = Date.now();
  const now = new Date();
  const fids = targetFid ? [targetFid] : await fetchAllEnabledFids();

  let resolved = 0;
  let skippedNoAddress = 0;
  let skippedNoDue = 0;
  let skippedThrottled = 0;
  let eligiblePlants = 0;
  const fidsToNotify: number[] = [];
  const results: NeynarFidProcessResult[] = [];

  for (let i = 0; i < fids.length; i += BATCH_SIZE) {
    const batch = fids.slice(i, i + BATCH_SIZE);
    const processed = await Promise.allSettled(
      batch.map((fid) => processNeynarFid(fid, now, debug, dryRun)),
    );

    for (const result of processed) {
      if (result.status !== 'fulfilled') {
        continue;
      }

      const entry = result.value;
      results.push(entry);

      if (!entry.address) {
        skippedNoAddress += 1;
        continue;
      }

      resolved += 1;

      if (entry.dueCount === 0) {
        skippedNoDue += 1;
        continue;
      }

      if (entry.userThrottled) {
        skippedThrottled += 1;
        continue;
      }

      if (entry.hasEligible) {
        fidsToNotify.push(entry.fid);
        eligiblePlants += entry.duePlants.filter((plant) => !plant.plantThrottled).length;
      }
    }

    if (i + BATCH_SIZE < fids.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  let publishResult: UntypedValue = null;
  if (!dryRun && fidsToNotify.length > 0) {
    const response = await publishToFids(
      fidsToNotify,
      '🪴 Plant Health Alert',
      'Your plant has under 12h left before it dies. Tap to feed it now!',
    );

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        provider: 'neynar',
        error: response.json || 'publish_failed',
      }, { status: 500 });
    }

    publishResult = response.json;

    for (const entry of results.filter((item) => fidsToNotify.includes(item.fid))) {
      await markThrottle(getPlantCareUserThrottleKey('neynar', entry.fid));
      for (const plant of entry.duePlants.filter((item) => !item.plantThrottled)) {
        await markThrottle(getPlantCarePlantThrottleKey('neynar', entry.fid, plant.id));
      }
    }
  }

  const summary = {
    id: `plantcare_${Date.now()}`,
    provider: 'neynar' as const,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date().toISOString(),
    dryRun,
    totalRecipients: fids.length,
    notified: dryRun ? 0 : fidsToNotify.length,
    skippedNoAddress,
    skippedNoDue,
    skippedThrottled,
    eligiblePlants,
    elapsedMs: Date.now() - startedAtMs,
    debug,
    result: publishResult,
  };

  await recordPlantCareRun(summary);

  return NextResponse.json({
    success: true,
    provider: 'neynar',
    dryRun,
    stats: {
      totalFids: fids.length,
      resolved,
      skippedNoAddress,
      skippedNoDue,
      skippedThrottled,
      eligiblePlants,
      notified: dryRun ? 0 : fidsToNotify.length,
      elapsedMs: summary.elapsedMs,
    },
    ...(debug ? { details: results, publishResult } : {}),
  });
}

async function processBaseDueOwner(
  owner: DuePlantOwnerSummary,
  enabledRecipients: Set<string>,
  debug: boolean,
  dryRun: boolean,
): Promise<BaseAddressProcessResult> {
  const userThrottled =
    debug || dryRun ? false : await getThrottleState(getPlantCareUserThrottleKey('base', owner.address));

  const duePlants = await Promise.all(
    owner.duePlants.map(async (plant) => {
      const plantThrottled =
        debug || dryRun
          ? false
          : await getThrottleState(getPlantCarePlantThrottleKey('base', owner.address, plant.id));

      return {
        id: plant.id,
        hoursLeft: plant.hoursLeft,
        plantThrottled,
      };
    }),
  );

  return {
    address: owner.address,
    enabled: enabledRecipients.has(owner.address),
    userThrottled,
    dueCount: duePlants.length,
    hasEligible: duePlants.some((plant) => !plant.plantThrottled),
    duePlants,
  };
}

async function applyBasePlantCareDeliveryOutcome(
  response: BaseNotificationChunkedSendResponse,
  eligiblePlantIdsByAddress: Map<string, number[]>,
) {
  const deliveredAddresses = new Set<string>();

  for (const batch of response.batches) {
    if (batch.response.results.length > 0) {
      for (const entry of batch.response.results) {
        if (entry.sent) {
          deliveredAddresses.add(entry.walletAddress.toLowerCase());
        }
      }
      continue;
    }

    if (batch.response.failedCount === 0) {
      for (const address of batch.requestedAddresses) {
        deliveredAddresses.add(address.toLowerCase());
      }
    }
  }

  for (const address of deliveredAddresses) {
    if (!eligiblePlantIdsByAddress.has(address)) {
      continue;
    }

    await markThrottle(getPlantCareUserThrottleKey('base', address));
    for (const plantId of eligiblePlantIdsByAddress.get(address) || []) {
      await markThrottle(getPlantCarePlantThrottleKey('base', address, plantId));
    }
  }
}

async function handleBasePlantCare(req: NextRequest, debug: boolean, dryRun: boolean, targetAddress?: string) {
  const snapshotMeta = await getCurrentBaseAudienceSnapshotMeta();
  if (!snapshotMeta) {
    return NextResponse.json({
      success: false,
      provider: 'base',
      error: 'base_audience_snapshot_missing',
    }, { status: 503 });
  }

  const normalizedTargetAddress = normalizeWalletAddress(targetAddress);
  const startedAtMs = Date.now();
  const dueOwners = await collectDuePlantsByOwner({
    clearSafePlantEpisode:
      debug || dryRun
        ? undefined
        : async (address, plantId) => clearThrottle(getPlantCarePlantThrottleKey('base', address, plantId)),
  });

  const enabledRecipients = new Set(await getCurrentBaseAudienceAddresses());
  const filteredOwners = normalizedTargetAddress
    ? dueOwners.filter((owner) => owner.address === normalizedTargetAddress)
    : dueOwners;

  let skippedNotEnabled = 0;
  let skippedThrottled = 0;
  let eligiblePlants = 0;
  const addressesToNotify: string[] = [];
  const results: BaseAddressProcessResult[] = [];
  const eligiblePlantIdsByAddress = new Map<string, number[]>();
  let sendErrorMessage: string | null = null;
  let sendErrorStatus = 503;

  for (const owner of filteredOwners) {
    const entry = await processBaseDueOwner(owner, enabledRecipients, debug, dryRun);
    results.push(entry);

    if (!entry.enabled) {
      skippedNotEnabled += 1;
      continue;
    }

    if (entry.userThrottled) {
      skippedThrottled += 1;
      continue;
    }

    const eligiblePlantIds = entry.duePlants.filter((plant) => !plant.plantThrottled).map((plant) => plant.id);
    if (eligiblePlantIds.length > 0) {
      addressesToNotify.push(entry.address);
      eligiblePlants += eligiblePlantIds.length;
      eligiblePlantIdsByAddress.set(entry.address, eligiblePlantIds);
    }
  }

  let publishResult: UntypedValue = null;
  if (!dryRun && addressesToNotify.length > 0) {
    const lockOwner = `base-plant-care:${Date.now()}`;
    const lockAcquired = await acquireBaseApiLock(lockOwner, BASE_REQUEST_LOCK_TTL_SECONDS);
    if (!lockAcquired) {
      return NextResponse.json({
        success: false,
        provider: 'base',
        error: 'Base notifications API is busy',
      }, { status: 409 });
    }

    try {
      try {
        const response = await sendBaseNotificationsInChunks({
          addresses: addressesToNotify,
          title: '🪴 Plant Health Alert',
          message: 'Your plant has under 12h left before it dies. Tap to feed it now!',
          targetPath: BASE_PLANT_CARE_TARGET_PATH,
        });
        publishResult = response;
        await applyBasePlantCareDeliveryOutcome(response, eligiblePlantIdsByAddress);
      } catch (error) {
        const partialResponse =
          typeof error === 'object' && error && 'partialResponse' in error
            ? (error as BaseNotificationChunkedSendError).partialResponse
            : undefined;

        if (partialResponse) {
          publishResult = {
            ...partialResponse,
            fatalError: error instanceof Error ? error.message : 'send_failed',
          };
          await applyBasePlantCareDeliveryOutcome(partialResponse, eligiblePlantIdsByAddress);
        }
        sendErrorMessage = error instanceof Error ? error.message : 'send_failed';
        sendErrorStatus =
          typeof error === 'object' && error && 'status' in error && typeof (error as { status?: number }).status === 'number'
            ? (error as { status?: number }).status || 503
            : 503;
      }
    } finally {
      await releaseBaseApiLock(lockOwner);
    }
  }

  const summary = {
    id: `plantcare_${Date.now()}`,
    provider: 'base' as const,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date().toISOString(),
    dryRun,
    totalRecipients: filteredOwners.length,
    notified:
      !dryRun && publishResult && typeof publishResult === 'object' && publishResult && 'sentCount' in publishResult
        ? Number(publishResult.sentCount || 0)
        : 0,
    skippedNotEnabled,
    skippedThrottled,
    eligiblePlants,
    elapsedMs: Date.now() - startedAtMs,
    debug,
    result: publishResult,
  };

  await recordPlantCareRun(summary);

  if (sendErrorMessage) {
    return NextResponse.json({
      success: false,
      provider: 'base',
      error: sendErrorMessage,
      snapshot: snapshotMeta,
      stats: {
        checkedOwners: filteredOwners.length,
        skippedNotEnabled,
        skippedThrottled,
        eligiblePlants,
        notified: summary.notified,
        elapsedMs: summary.elapsedMs,
      },
      ...(debug ? { details: results, publishResult } : { publishResult }),
    }, { status: sendErrorStatus });
  }

  return NextResponse.json({
    success: true,
    provider: 'base',
    dryRun,
    snapshot: snapshotMeta,
    stats: {
      checkedOwners: filteredOwners.length,
      skippedNotEnabled,
      skippedThrottled,
      eligiblePlants,
      notified: summary.notified,
      elapsedMs: summary.elapsedMs,
    },
    ...(debug ? { details: results, publishResult } : {}),
  });
}

async function handleRequest(req: NextRequest) {
  const url = new URL(req.url);
  const query = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  const debug = query.success ? (query.data.debug ?? false) : false;
  const dryRun = query.success ? (query.data.dry ?? false) : false;
  const targetFid = query.success ? query.data.fid : undefined;
  const targetAddress = query.success ? query.data.address : undefined;
  const isAdmin = validateAdminKey(req);

  if (!debug && !targetFid && !targetAddress && !verifyVercelCron(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  if ((debug || targetFid || targetAddress) && !isAdmin && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (SERVER_ENV.NOTIFICATION_PROVIDER === 'base') {
    return handleBasePlantCare(req, debug, dryRun, targetAddress);
  }

  return handleNeynarPlantCare(req, debug, dryRun, targetFid);
}

export async function GET(req: NextRequest) {
  return handleRequest(req);
}

export async function POST(req: NextRequest) {
  return handleRequest(req);
}
