import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { CLIENT_ENV, SERVER_ENV } from '@/lib/env-config';
import { getPlantsByOwnerWithRpc } from '@/lib/contracts';
import { z } from 'zod';
import { differenceInSeconds } from 'date-fns';

// Configuration
const THRESHOLD_SECONDS = 12 * 60 * 60; // 12 hours
const THROTTLE_SECONDS = 6 * 60 * 60; // 6 hours cooldown between notifications
const REDIS_KEY_PREFIX = 'notif:plant12h';
const BATCH_SIZE = 30; // Process 30 FIDs in parallel

// Validation Schemas (using Zod v4 stringbool for cleaner boolean parsing)
const QuerySchema = z.object({
  debug: z.stringbool().optional(),
  fid: z.coerce.number().int().optional(),
  dry: z.stringbool().optional(),
});

type PublishBody = {
  target_fids: number[];
  notification: { title: string; body: string; target_url: string };
};

// Verify Vercel cron authorization
function verifyVercelCron(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // If no CRON_SECRET is set, allow requests (for development)
  if (!cronSecret) return true;

  // Vercel sends: Authorization: Bearer <CRON_SECRET>
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Fetch ALL enabled FIDs from Neynar with proper pagination.
 * Loops through all pages using cursor until no more data.
 */
async function fetchAllEnabledFids(): Promise<number[]> {
  const apiKey = SERVER_ENV.NEYNAR_API_KEY;
  if (!apiKey) return [];

  const allFids: number[] = [];
  let cursor: string | null = null;
  let pageCount = 0;
  const maxPages = 100; // Safety limit to prevent infinite loops

  do {
    const url = new URL('https://api.neynar.com/v2/farcaster/frame/notification_tokens/');
    url.searchParams.set('limit', '100'); // Max per page
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const res = await fetch(url.toString(), { headers: { 'x-api-key': apiKey } });
    if (!res.ok) {
      console.error(`[fetchAllEnabledFids] Neynar API error: ${res.status}`);
      break;
    }

    const json = await res.json();
    const tokens: Array<{ fid: number }> | undefined = json?.notification_tokens;

    if (tokens?.length) {
      for (const t of tokens) {
        if (!allFids.includes(t.fid)) {
          allFids.push(t.fid);
        }
      }
    }

    // Get next page cursor
    cursor = json?.next?.cursor || null;
    pageCount++;

  } while (cursor && pageCount < maxPages);

  console.log(`[plant-care cron] Fetched ${allFids.length} unique FIDs from ${pageCount} Neynar pages`);
  return allFids;
}

async function publishToFids(fids: number[], title: string, body: string) {
  if (fids.length === 0) return { ok: true } as const;
  const apiKey = SERVER_ENV.NEYNAR_API_KEY;
  if (!apiKey) return { ok: false, error: 'NEYNAR_API_KEY missing' } as const;
  const payload: PublishBody = {
    target_fids: fids,
    notification: { title, body, target_url: CLIENT_ENV.APP_URL },
  };
  const res = await fetch('https://api.neynar.com/v2/farcaster/frame/notifications/', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json } as const;
}

async function clearPlantEpisode(fid: number, plantId: number) {
  try { await (redis as any)?.del?.(`${REDIS_KEY_PREFIX}:fid:${fid}:plant:${plantId}`); } catch { }
}

function shouldThrottle(fid: number, opts?: { dry?: boolean }): Promise<boolean> {
  const key = `${REDIS_KEY_PREFIX}:fid:${fid}`;
  return (async () => {
    if (!redis) return false;
    const exists = await (redis as any)?.get?.(key);
    if (exists) return true;
    if (!opts?.dry) await (redis as any)?.set?.(key, '1', { ex: THROTTLE_SECONDS });
    return false;
  })();
}

function shouldThrottlePlant(fid: number, plantId: number, opts?: { dry?: boolean }): Promise<boolean> {
  const key = `${REDIS_KEY_PREFIX}:fid:${fid}:plant:${plantId}`;
  return (async () => {
    if (!redis) return false;
    const exists = await (redis as any)?.get?.(key);
    if (exists) return true;
    if (!opts?.dry) await (redis as any)?.set?.(key, '1', { ex: THROTTLE_SECONDS });
    return false;
  })();
}

// Type for processing result
type FidProcessResult = {
  fid: number;
  address: string | null;
  userThrottled: boolean;
  hasEligible: boolean;
  dueCount: number;
  plants: Array<{ id: number; timestamp: number; left: number; due: boolean; plantThrottled: boolean }>;
};

/**
 * Process a single FID - resolve address, get plants, check eligibility
 */
async function processFid(
  fid: number,
  rpcUrl: string,
  now: Date,
  debug: boolean,
  dryRun: boolean
): Promise<FidProcessResult> {
  // Resolve address: prefer cached mapping, fallback to Farcaster API
  let address: string | null = null;
  try {
    const cached = await (redis as any)?.get?.(`fidmap:${fid}`);
    if (cached) {
      address = String(cached).toLowerCase();
    } else {
      const res = await fetch(`https://api.farcaster.xyz/fc/primary-address?fid=${fid}&protocol=ethereum`);
      if (res.ok) {
        const data = await res.json();
        const addr = data?.result?.address?.address as string | undefined;
        if (addr) {
          address = addr.toLowerCase();
          await (redis as any)?.set?.(`fidmap:${fid}`, address);
        }
      }
    }
  } catch { }

  if (!address) {
    return { fid, address: null, userThrottled: false, hasEligible: false, dueCount: 0, plants: [] };
  }

  const plants = await getPlantsByOwnerWithRpc(address, rpcUrl);
  const plantDebug: Array<{ id: number; timestamp: number; left: number; due: boolean; plantThrottled: boolean }> = [];

  // Clear safe episodes (when plant has more than threshold time left)
  if (!debug && !dryRun) {
    for (const p of plants || []) {
      const t = Number(p.timeUntilStarving ?? 0);
      const plantDate = new Date(t * 1000);
      const left = differenceInSeconds(plantDate, now);
      if (left > THRESHOLD_SECONDS) {
        await clearPlantEpisode(fid, Number(p.id));
      }
    }
  }

  // Find plants with 12h or less remaining
  const due = (plants || []).filter(p => {
    const t = Number(p.timeUntilStarving ?? 0);
    const plantDate = new Date(t * 1000);
    const left = differenceInSeconds(plantDate, now);
    return left > 0 && left <= THRESHOLD_SECONDS;
  });

  // Per-user throttle: bypass in debug/dry mode
  const userThrottled = (debug || dryRun) ? false : await shouldThrottle(fid, { dry: dryRun });

  if (due.length === 0) {
    for (const p of plants || []) {
      const t = Number(p.timeUntilStarving ?? 0);
      const plantDate = new Date(t * 1000);
      const left = differenceInSeconds(plantDate, now);
      plantDebug.push({
        id: Number(p.id),
        timestamp: t,
        left,
        due: false,
        plantThrottled: false
      });
    }
    return { fid, address, userThrottled, hasEligible: false, dueCount: 0, plants: plantDebug };
  }

  let hasAny = false;
  for (const p of due) {
    const pid = Number(p.id);
    const plantThrottled = (debug || dryRun) ? false : await shouldThrottlePlant(fid, pid, { dry: dryRun });
    if (!plantThrottled) {
      hasAny = true;
    }
    const t = Number(p.timeUntilStarving ?? 0);
    const plantDate = new Date(t * 1000);
    const left = differenceInSeconds(plantDate, now);
    plantDebug.push({ id: pid, timestamp: t, left, due: true, plantThrottled });
  }

  // Include non-due plants in debug output
  for (const p of (plants || []).filter(pp => due.every(d => Number(d.id) !== Number(pp.id)))) {
    const t = Number(p.timeUntilStarving ?? 0);
    const plantDate = new Date(t * 1000);
    const left = differenceInSeconds(plantDate, now);
    plantDebug.push({ id: Number(p.id), timestamp: t, left, due: false, plantThrottled: false });
  }

  return { fid, address, userThrottled, hasEligible: hasAny, dueCount: due.length, plants: plantDebug };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes (Pro plan limit)

export async function GET(req: NextRequest) {
  try {
    // Parse query params
    const url = new URL(req.url);
    const queryResult = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    const debug = queryResult.success ? (queryResult.data.debug ?? false) : false;
    const targetFid = queryResult.success ? queryResult.data.fid : undefined;
    const dryRun = queryResult.success ? (queryResult.data.dry ?? false) : false;

    // Verify Vercel cron auth (skip for debug/manual calls with fid param)
    if (!targetFid && !debug && !verifyVercelCron(req)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch eligible fids
    let fids: number[];
    if (targetFid) {
      fids = [targetFid];
    } else {
      fids = await fetchAllEnabledFids();
    }

    if (!debug && !dryRun) {
      try {
        for (const fid of fids) {
          await (redis as any)?.sadd?.('notif:eligible:fids', String(fid));
        }
      } catch { }
    }

    const startedAt = Date.now();
    const rpcUrl = 'https://base-rpc.publicnode.com';
    const now = new Date();

    let resolved = 0;
    let skippedNoAddress = 0;
    let skippedNoDue = 0;
    let skippedThrottled = 0;
    let plantEpisodes = 0;
    const fidsToNotify: number[] = [];
    const details: FidProcessResult[] = [];

    // Process FIDs in parallel batches
    for (let i = 0; i < fids.length; i += BATCH_SIZE) {
      const batch = fids.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(fid => processFid(fid, rpcUrl, now, debug, dryRun))
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const r = result.value;
          details.push(r);

          if (!r.address) {
            skippedNoAddress++;
          } else {
            resolved++;
            if (r.dueCount === 0) {
              skippedNoDue++;
            } else if (r.userThrottled) {
              skippedThrottled++;
            } else if (r.hasEligible) {
              fidsToNotify.push(r.fid);
              plantEpisodes += r.plants.filter(p => p.due && !p.plantThrottled).length;
            }
          }
        }
      }

      // Log progress every 10 batches
      if ((i / BATCH_SIZE) % 10 === 0) {
        console.log(`[plant-care cron] Processed ${Math.min(i + BATCH_SIZE, fids.length)}/${fids.length} FIDs`);
      }
    }

    // Send notifications (unless dry run)
    let publishResult: { ok: boolean; json?: unknown } = { ok: true };
    if (fidsToNotify.length > 0 && !dryRun) {
      const title = '🪴 Plant Health Alert';
      const body = 'Your plant has under 12h left before it dies. Tap to feed it now!';
      publishResult = await publishToFids(fidsToNotify, title, body);

      if (!publishResult.ok) {
        return NextResponse.json({ success: false, error: publishResult.json || 'publish_failed' }, { status: 500 });
      }

      // Log for stats
      try {
        await (redis as any)?.set?.(`${REDIS_KEY_PREFIX}:last`, Date.now());
        await (redis as any)?.incr?.(`${REDIS_KEY_PREFIX}:runs`);
        await (redis as any)?.incrby?.(`${REDIS_KEY_PREFIX}:sent:count`, fidsToNotify.length);
        await (redis as any)?.lpush?.(`${REDIS_KEY_PREFIX}:log`, JSON.stringify({
          ts: Date.now(),
          sent: fidsToNotify.length,
          eligible: plantEpisodes,
          resolved,
          skippedNoAddress,
          skippedNoDue,
          skippedThrottled,
        }));
        await (redis as any)?.ltrim?.(`${REDIS_KEY_PREFIX}:log`, 0, 99);
      } catch { }
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(`[plant-care cron] Completed in ${elapsedMs}ms - notified: ${fidsToNotify.length}, resolved: ${resolved}, skipped: ${skippedNoAddress + skippedNoDue + skippedThrottled}`);

    return NextResponse.json({
      success: true,
      dryRun,
      stats: {
        totalFids: fids.length,
        resolved,
        skippedNoAddress,
        skippedNoDue,
        skippedThrottled,
        eligiblePlants: plantEpisodes,
        notified: fidsToNotify.length,
        elapsedMs,
      },
      ...(debug ? { details, publishResult } : {}),
    });
  } catch (e: any) {
    console.error('[plant-care cron] Error:', e);
    return NextResponse.json({ success: false, error: e?.message || 'cron_failed' }, { status: 500 });
  }
}
