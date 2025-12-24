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

// Validation Schemas
const QuerySchema = z.object({
  debug: z.enum(['0', '1', 'true', 'false']).optional().transform(val => val === '1' || val === 'true'),
  fid: z.string().optional().transform(val => val ? parseInt(val, 10) : undefined),
  dry: z.enum(['0', '1', 'true', 'false']).optional().transform(val => val === '1' || val === 'true'),
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes (Pro plan limit)

export async function GET(req: NextRequest) {
  try {
    // Parse query params
    const url = new URL(req.url);
    const queryResult = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    const debug = queryResult.success ? queryResult.data.debug : false;
    const targetFid = queryResult.success ? queryResult.data.fid : undefined;
    const dryRun = queryResult.success ? queryResult.data.dry : false;

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

    const details: Array<{
      fid: number;
      address?: string | null;
      userThrottled?: boolean;
      plants?: Array<{ id: number; timestamp: number; left: number; due: boolean; plantThrottled: boolean }>;
      dueCount?: number
    }> = [];

    for (const fid of fids) {
      // Resolve address: prefer cached mapping, fallback to Farcaster API
      let address: string | null = null;
      try {
        address = await (async () => {
          const cached = await (redis as any)?.get?.(`fidmap:${fid}`);
          if (cached) return String(cached).toLowerCase();
          const res = await fetch(`https://api.farcaster.xyz/fc/primary-address?fid=${fid}&protocol=ethereum`);
          if (!res.ok) return null;
          const data = await res.json();
          const addr = data?.result?.address?.address as string | undefined;
          if (addr) await (redis as any)?.set?.(`fidmap:${fid}`, addr.toLowerCase());
          return addr ? addr.toLowerCase() : null;
        })();
      } catch { }

      if (!address) {
        skippedNoAddress++;
        details.push({ fid, address: null, dueCount: 0, plants: [] });
        continue;
      }

      const plants = await getPlantsByOwnerWithRpc(address, rpcUrl);
      resolved++;

      // Build plant debug entries
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

      // Find plants with 3h or less remaining
      const due = (plants || []).filter(p => {
        const t = Number(p.timeUntilStarving ?? 0);
        const plantDate = new Date(t * 1000);
        const left = differenceInSeconds(plantDate, now);
        return left > 0 && left <= THRESHOLD_SECONDS;
      });

      // Per-user throttle: bypass in debug/dry mode
      const userThrottled = (debug || dryRun) ? false : await shouldThrottle(fid, { dry: dryRun });

      if (due.length === 0) {
        skippedNoDue++;
        for (const p of plants || []) {
          const t = Number(p.timeUntilStarving ?? 0);
          const plantDate = new Date(t * 1000);
          const left = differenceInSeconds(plantDate, now);
          plantDebug.push({
            id: Number(p.id),
            timestamp: t,
            left,
            due: left > 0 && left <= THRESHOLD_SECONDS,
            plantThrottled: false
          });
        }
        details.push({ fid, address, userThrottled, dueCount: 0, plants: plantDebug });
        continue;
      }

      let hasAny = false;
      for (const p of due) {
        const pid = Number(p.id);
        const plantThrottled = (debug || dryRun) ? false : await shouldThrottlePlant(fid, pid, { dry: dryRun });
        if (plantThrottled) {
          if (!debug && !dryRun) skippedThrottled++;
        } else {
          hasAny = true;
          plantEpisodes++;
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

      details.push({ fid, address, userThrottled, dueCount: due.length, plants: plantDebug });
      if (hasAny) fidsToNotify.push(fid);
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

      if (!debug) {
        try {
          const ts = Date.now();
          await (redis as any)?.lpush?.(`${REDIS_KEY_PREFIX}:log`, JSON.stringify({ ts, fids: fidsToNotify }));
          await (redis as any)?.ltrim?.(`${REDIS_KEY_PREFIX}:log`, 0, 99);
          for (const fid of fidsToNotify) {
            await (redis as any)?.hset?.(`${REDIS_KEY_PREFIX}:last`, { [fid]: String(ts) });
          }
          try {
            await (redis as any)?.incrby?.(`${REDIS_KEY_PREFIX}:sentCount`, fidsToNotify.length);
          } catch { }
        } catch { }
      }
    }

    const summary = {
      success: true,
      dryRun,
      startedAt,
      endedAt: Date.now(),
      thresholdHours: THRESHOLD_SECONDS / 3600,
      fetchedEligible: fids.length,
      resolvedAddresses: resolved,
      plantEpisodes,
      notified: dryRun ? 0 : fidsToNotify.length,
      wouldNotify: dryRun ? fidsToNotify.length : undefined,
      skipped: { noAddress: skippedNoAddress, noDue: skippedNoDue, throttled: skippedThrottled },
      debug: { nowSec: Math.floor(now.getTime() / 1000), details },
    } as const;

    // Save run stats (unless dry run)
    if (!dryRun) {
      try {
        await (redis as any)?.set?.(`${REDIS_KEY_PREFIX}:lastRun`, JSON.stringify(summary), { ex: 3600 });
        await (redis as any)?.lpush?.(`${REDIS_KEY_PREFIX}:runs`, JSON.stringify(summary));
        await (redis as any)?.ltrim?.(`${REDIS_KEY_PREFIX}:runs`, 0, 49);
      } catch { }
    }

    return NextResponse.json(summary);
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'cron_failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
