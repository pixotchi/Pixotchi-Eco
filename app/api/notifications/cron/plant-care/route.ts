import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { CLIENT_ENV, SERVER_ENV } from '@/lib/env-config';
import { getPlantsByOwnerWithRpc } from '@/lib/contracts';
import { z } from 'zod';
import { differenceInSeconds } from 'date-fns';

// Validation Schemas
const QuerySchema = z.object({
  debug: z.enum(['0', '1', 'true', 'false']).optional().transform(val => val === '1' || val === 'true'),
});

type PublishBody = {
  target_fids: number[];
  notification: { title: string; body: string; target_url: string };
};

async function fetchEnabledFids(cursor?: string): Promise<{ fids: number[]; next?: string }> {
  const apiKey = SERVER_ENV.NEYNAR_API_KEY;
  if (!apiKey) return { fids: [] };
  const url = new URL('https://api.neynar.com/v2/farcaster/frame/notification_tokens/');
  if (cursor) url.searchParams.set('cursor', cursor);
  const res = await fetch(url.toString(), { headers: { 'x-api-key': apiKey } });
  if (!res.ok) return { fids: [] };
  const json = await res.json();
  const tokens: Array<{ fid: number }> | undefined = json?.notification_tokens;
  const nextCursor: string | undefined = json?.next?.cursor;
  const fids = (tokens || []).map(t => t.fid).filter((v, i, a) => a.indexOf(v) === i);
  return { fids, next: nextCursor };
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
  try { await (redis as any)?.del?.(`notif:plant1h:fid:${fid}:plant:${plantId}`); } catch {}
}

function shouldThrottle(fid: number, opts?: { dry?: boolean }): Promise<boolean> {
  const key = `notif:plant1h:fid:${fid}`;
  return (async () => {
    if (!redis) return false;
    const exists = await (redis as any)?.get?.(key);
    if (exists) return true;
    if (!opts?.dry) await (redis as any)?.set?.(key, '1', { ex: 2 * 60 * 60 });
    return false;
  })();
}

function shouldThrottlePlant(fid: number, plantId: number, opts?: { dry?: boolean }): Promise<boolean> {
  const key = `notif:plant1h:fid:${fid}:plant:${plantId}`;
  return (async () => {
    if (!redis) return false;
    const exists = await (redis as any)?.get?.(key);
    if (exists) return true;
    if (!opts?.dry) await (redis as any)?.set?.(key, '1', { ex: 2 * 60 * 60 });
    return false;
  })();
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const queryResult = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    const debug = queryResult.success ? queryResult.data.debug : false;

    const { fids } = await fetchEnabledFids();
    if (!debug) { try { for (const fid of fids) { await (redis as any)?.sadd?.('notif:eligible:fids', String(fid)); } } catch {} }

    const startedAt = Date.now();
    const rpcUrl = 'https://base-rpc.publicnode.com';
    const now = new Date();

    let resolved = 0;
    let skippedNoAddress = 0;
    let skippedNoDue = 0;
    let skippedThrottled = 0;
    let plantEpisodes = 0;
    const fidsToNotify: number[] = [];

    const details: Array<{ fid: number; address?: string | null; userThrottled?: boolean; plants?: Array<{ id: number; timestamp: number; left: number; due: boolean; plantThrottled: boolean }>; dueCount?: number }>
      = [];

    for (const fid of fids) {
      // Resolve address: prefer cached mapping, fallback to Farcaster API
      let address: string | null = null;
      try { address = await (async () => {
        const cached = await (redis as any)?.get?.(`fidmap:${fid}`);
        if (cached) return String(cached).toLowerCase();
        const res = await fetch(`https://api.farcaster.xyz/fc/primary-address?fid=${fid}&protocol=ethereum`);
        if (!res.ok) return null;
        const data = await res.json();
        const addr = data?.result?.address?.address as string | undefined;
        if (addr) await (redis as any)?.set?.(`fidmap:${fid}`, addr.toLowerCase());
        return addr ? addr.toLowerCase() : null;
      })(); } catch {}

      if (!address) { skippedNoAddress++; details.push({ fid, address: null, dueCount: 0, plants: [] }); continue; }

      const plants = await getPlantsByOwnerWithRpc(address, rpcUrl);
      resolved++;

      // Build plant debug entries
      const plantDebug: Array<{ id: number; timestamp: number; left: number; due: boolean; plantThrottled: boolean }> = [];

      // Clear safe episodes and prepare due list
      if (!debug) {
        for (const p of plants || []) {
          const t = Number(p.timeUntilStarving ?? 0);
          const plantDate = new Date(t * 1000);
          // Calculate difference in seconds using date-fns
          const left = differenceInSeconds(plantDate, now);
          if (left > 3600) { await clearPlantEpisode(fid, Number(p.id)); }
        }
      }

      const due = (plants || []).filter(p => {
        const t = Number(p.timeUntilStarving ?? 0);
        const plantDate = new Date(t * 1000);
        const left = differenceInSeconds(plantDate, now);
        return left > 0 && left <= 3600;
      });

      // Per-user throttle: bypass completely in debug
      const userThrottled = debug ? false : await shouldThrottle(fid);
      if (due.length === 0) {
        skippedNoDue++;
        for (const p of plants || []) {
          const t = Number(p.timeUntilStarving ?? 0); 
          const plantDate = new Date(t * 1000);
          const left = differenceInSeconds(plantDate, now);
          const plantThrottled = false;
          plantDebug.push({ id: Number(p.id), timestamp: t, left, due: left > 0 && left <= 3600, plantThrottled });
        }
        details.push({ fid, address, userThrottled, dueCount: 0, plants: plantDebug });
        continue;
      }

      let hasAny = false;
      for (const p of due) {
        const pid = Number(p.id);
        const plantThrottled = debug ? false : await shouldThrottlePlant(fid, pid);
        if (plantThrottled) { if (!debug) skippedThrottled++; }
        else { hasAny = true; plantEpisodes++; }
        const t = Number(p.timeUntilStarving ?? 0); 
        const plantDate = new Date(t * 1000);
        const left = differenceInSeconds(plantDate, now);
        plantDebug.push({ id: pid, timestamp: t, left, due: true, plantThrottled });
      }
      // include non-due plants in debug too
      for (const p of (plants || []).filter(pp => due.every(d => Number(d.id) !== Number(pp.id)))) {
        const t = Number(p.timeUntilStarving ?? 0); 
        const plantDate = new Date(t * 1000);
        const left = differenceInSeconds(plantDate, now);
        plantDebug.push({ id: Number(p.id), timestamp: t, left, due: false, plantThrottled: false });
      }

      details.push({ fid, address, userThrottled, dueCount: due.length, plants: plantDebug });
      if (hasAny) fidsToNotify.push(fid);
    }

    if (fidsToNotify.length > 0) {
      const title = '🪴 Plant Death Alert';
      const body = 'Your plant has under 1h left before it dies. Tap to feed it now.';
      const resp = await publishToFids(fidsToNotify, title, body);
      if (!resp.ok) {
        return NextResponse.json({ success: false, error: resp.json || 'publish_failed' }, { status: 500 });
      }
      if (!debug) {
        try {
          const ts = Date.now();
          await (redis as any)?.lpush?.('notif:plant1h:log', JSON.stringify({ ts, fids: fidsToNotify }));
          await (redis as any)?.ltrim?.('notif:plant1h:log', 0, 99);
          for (const fid of fidsToNotify) await (redis as any)?.hset?.('notif:plant1h:last', { [fid]: String(ts) });
          try { await (redis as any)?.incrby?.('notif:plant1h:sentCount', fidsToNotify.length); } catch {}
        } catch {}
      }
    }

    const summary = {
      success: true,
      startedAt,
      endedAt: Date.now(),
      fetchedEligible: fids.length,
      resolvedAddresses: resolved,
      plantEpisodes,
      notified: fidsToNotify.length,
      skipped: { noAddress: skippedNoAddress, noDue: skippedNoDue, throttled: skippedThrottled },
      debug: { nowSec: Math.floor(now.getTime() / 1000), details },
    } as const;

    try {
      await (redis as any)?.set?.('notif:plant1h:lastRun', JSON.stringify(summary), { ex: 3600 });
      await (redis as any)?.lpush?.('notif:plant1h:runs', JSON.stringify(summary));
      await (redis as any)?.ltrim?.('notif:plant1h:runs', 0, 49);
    } catch {}

    return NextResponse.json(summary);
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'cron_failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) { return GET(req); }
