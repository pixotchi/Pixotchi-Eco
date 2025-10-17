import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { CLIENT_ENV, SERVER_ENV } from '@/lib/env-config';
import { getPlantsByOwnerWithRpc } from '@/lib/contracts';

const WARN_WINDOW_SECONDS = 2 * 60 * 60; // 2 hours
const EXPIRY_GRACE_SECONDS = 60 * 60; // consider expired notifications within last hour
const WARN_KEY_PREFIX = 'notif:fence:warned:fid:';
const EXPIRE_KEY_PREFIX = 'notif:fence:expired:fid:';
const PENDING_KEY_PREFIX = 'notif:fence:pending:fid:';

function warnKey(fid: number, plantId: number) {
  return `${WARN_KEY_PREFIX}${fid}:plant:${plantId}`;
}

function expireKey(fid: number, plantId: number) {
  return `${EXPIRE_KEY_PREFIX}${fid}:plant:${plantId}`;
}

function pendingKey(fid: number, plantId: number) {
  return `${PENDING_KEY_PREFIX}${fid}:plant:${plantId}`;
}

function parsePlantIdFromPendingKey(key: string): number | null {
  const parts = key.split(':');
  const last = parts[parts.length - 1];
  const value = Number(last);
  return Number.isFinite(value) ? value : null;
}

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
  const fids = (tokens || []).map((t) => t.fid).filter((v, i, a) => a.indexOf(v) === i);
  return { fids, next: nextCursor };
}

async function publishToFids(
  fids: number[],
  title: string,
  body: string,
) {
  if (fids.length === 0) return { ok: true } as const;
  const apiKey = SERVER_ENV.NEYNAR_API_KEY;
  if (!apiKey) return { ok: false, error: 'NEYNAR_API_KEY missing' } as const;
  const payload = {
    target_fids: fids,
    notification: { title, body, target_url: CLIENT_ENV.APP_URL },
  };
  const res = await fetch('https://api.neynar.com/v2/farcaster/frame/notifications/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json } as const;
}

async function setWithTtl(key: string, value: string | number, ttlSeconds: number) {
  try {
    await (redis as any)?.set?.(key, String(value), { ex: ttlSeconds });
  } catch {}
}

async function hasKey(key: string): Promise<boolean> {
  try {
    const exists = await (redis as any)?.exists?.(key);
    return Boolean(exists);
  } catch {
    return false;
  }
}

async function deleteKey(key: string) {
  try {
    await (redis as any)?.del?.(key);
  } catch {}
}

async function recordLogs(type: 'warn' | 'expire', fids: number[], details: unknown, debug: boolean) {
  if (debug || !redis || fids.length === 0) return;
  const ts = Date.now();
  const base = `notif:fence:${type}`;
  try {
    await (redis as any)?.lpush?.(`${base}:log`, JSON.stringify({ ts, fids, details }));
    await (redis as any)?.ltrim?.(`${base}:log`, 0, 199);
    await (redis as any)?.incrby?.(`${base}:sentCount`, fids.length);
    await (redis as any)?.sadd?.('notif:eligible:fids', ...(fids.map((fid) => String(fid))));
    const pairs: Record<string, string> = {};
    for (const fid of fids) {
      pairs[String(fid)] = String(ts);
    }
    await (redis as any)?.hset?.(`${base}:last`, pairs);
  } catch {}
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const debug = url.searchParams.get('debug') === '1';

    const { fids } = await fetchEnabledFids();
    const nowSec = Math.floor(Date.now() / 1000);
    const rpcUrl = 'https://base-rpc.publicnode.com';

    const warnFids: number[] = [];
    const expireFids: number[] = [];
    const details: Array<{
      fid: number;
      address?: string | null;
      warn: Array<{ id: number; left: number; effectUntil: number }>;
      expire: Array<{ id: number; left: number; effectUntil: number }>;
      pendingExpired: Array<{ id: number; effectUntil: number }>;
      skipped?: string;
    }> = [];

    let resolved = 0;
    let skippedNoAddress = 0;

    for (const fid of fids) {
      let address: string | null = null;
      try {
        address = await (async () => {
          const cached = await (redis as any)?.get?.(`fidmap:${fid}`);
          if (cached) return String(cached).toLowerCase();
          const resAddr = await fetch(`https://api.farcaster.xyz/fc/primary-address?fid=${fid}&protocol=ethereum`);
          if (!resAddr.ok) return null;
          const data = await resAddr.json();
          const addr = data?.result?.address?.address as string | undefined;
          if (addr) await (redis as any)?.set?.(`fidmap:${fid}`, addr.toLowerCase());
          return addr ? addr.toLowerCase() : null;
        })();
      } catch {}

      if (!address) {
        skippedNoAddress++;
        details.push({ fid, address: null, warn: [], expire: [], pendingExpired: [], skipped: 'no_address' });
        continue;
      }

      let plants: Awaited<ReturnType<typeof getPlantsByOwnerWithRpc>> = [];
      try {
        plants = await getPlantsByOwnerWithRpc(address, rpcUrl);
        resolved++;
      } catch {
        details.push({ fid, address, warn: [], expire: [], pendingExpired: [], skipped: 'plant_fetch_failed' });
        continue;
      }

      const warnPlants: Array<{ id: number; left: number; effectUntil: number }> = [];
      const expirePlants: Array<{ id: number; left: number; effectUntil: number }> = [];
      const pendingExpired: Array<{ id: number; effectUntil: number }> = [];
      const activeFencePlantIds = new Set<number>();

      for (const plant of plants || []) {
        const extensions = plant?.extensions || [];
        for (const extension of extensions) {
          const owned = extension?.shopItemOwned || [];
          for (const item of owned) {
            if (!item?.effectIsOngoingActive) continue;
            const name = (item?.name || '').toLowerCase();
            if (!name.includes('fence') && !name.includes('shield')) continue;

            const plantId = Number(plant.id);
            const effectUntil = Number(item.effectUntil || 0);
            if (!Number.isFinite(plantId) || !Number.isFinite(effectUntil)) continue;

            activeFencePlantIds.add(plantId);
            if (redis) {
              await setWithTtl(pendingKey(fid, plantId), effectUntil, 4 * 24 * 60 * 60);
            }

            const secondsLeft = effectUntil - nowSec;

            if (secondsLeft > 0 && secondsLeft <= WARN_WINDOW_SECONDS) {
              const key = warnKey(fid, plantId);
              const alreadyWarned = debug ? false : await hasKey(key);
              if (!alreadyWarned) {
                warnPlants.push({ id: plantId, left: secondsLeft, effectUntil });
                if (!debug) await setWithTtl(key, '1', WARN_WINDOW_SECONDS);
              }
            }

            if (secondsLeft <= 0 && secondsLeft >= -EXPIRY_GRACE_SECONDS) {
              const key = expireKey(fid, plantId);
              const alreadyExpired = debug ? false : await hasKey(key);
              if (!alreadyExpired) {
                expirePlants.push({ id: plantId, left: secondsLeft, effectUntil });
                if (!debug) {
                  await setWithTtl(key, '1', 3 * 24 * 60 * 60);
                  await deleteKey(pendingKey(fid, plantId));
                }
              }
            }
          }
        }
      }

      if (!debug && redis?.scan) {
        let cursor = '0';
        const pattern = `${PENDING_KEY_PREFIX}${fid}:plant:*`;
        do {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const resp: any = await (redis as any)?.scan?.(cursor, 'MATCH', pattern, 'COUNT', 100);
          cursor = resp?.[0] || '0';
          const keys: string[] = resp?.[1] || [];
          for (const key of keys) {
            const plantId = parsePlantIdFromPendingKey(key);
            if (plantId == null) continue;
            if (activeFencePlantIds.has(plantId)) continue;
            const effectUntilStr = await (redis as any)?.get?.(key);
            const effectUntil = Number(effectUntilStr);
            if (!Number.isFinite(effectUntil)) continue;
            if (nowSec >= effectUntil && nowSec <= effectUntil + EXPIRY_GRACE_SECONDS) {
              const expKey = expireKey(fid, plantId);
              const alreadyExpired = await hasKey(expKey);
              if (!alreadyExpired) {
                expirePlants.push({ id: plantId, left: effectUntil - nowSec, effectUntil });
                await setWithTtl(expKey, '1', 3 * 24 * 60 * 60);
              }
              pendingExpired.push({ id: plantId, effectUntil });
              await deleteKey(key);
            }
            if (nowSec > effectUntil + EXPIRY_GRACE_SECONDS) {
              await deleteKey(key);
            }
          }
        } while (cursor !== '0');
      }

      if (warnPlants.length > 0) warnFids.push(fid);
      if (expirePlants.length > 0 || pendingExpired.length > 0) expireFids.push(fid);

      details.push({ fid, address, warn: warnPlants, expire: expirePlants, pendingExpired });
    }

    const warnResponse = await publishToFids(
      warnFids,
      '🛡️ Fence expiring soon',
      'Your plant fence has less than 2 hours left. Get ready to reapply when it ends.',
    );
    if (!warnResponse.ok && warnFids.length > 0) {
      return NextResponse.json({ success: false, error: warnResponse.json || 'warn_publish_failed' }, { status: 500 });
    }

    const expireResponse = await publishToFids(
      expireFids,
      '⚠️ Fence protection ended',
      'Your plant fence has expired. Reapply it now to stay protected.',
    );
    if (!expireResponse.ok && expireFids.length > 0) {
      return NextResponse.json({ success: false, error: expireResponse.json || 'expire_publish_failed' }, { status: 500 });
    }

    await recordLogs('warn', warnFids, { details: details.filter((d) => d.warn.length > 0) }, debug);
    await recordLogs('expire', expireFids, { details: details.filter((d) => d.expire.length > 0 || d.pendingExpired.length > 0) }, debug);

    const summary = {
      success: true,
      startedAt: nowSec,
      endedAt: Math.floor(Date.now() / 1000),
      fetchedEligible: fids.length,
      resolvedAddresses: resolved,
      warned: warnFids.length,
      expired: expireFids.length,
      skipped: { noAddress: skippedNoAddress },
      debug: {
        details,
        warnResponse: warnResponse.json,
        expireResponse: expireResponse.json,
      },
    } as const;

    if (redis && !debug) {
      try {
        await (redis as any)?.set?.('notif:fence:lastRun', JSON.stringify(summary), { ex: 3600 });
        await (redis as any)?.lpush?.('notif:fence:runs', JSON.stringify(summary));
        await (redis as any)?.ltrim?.('notif:fence:runs', 0, 49);
      } catch {}
    }

    return NextResponse.json(summary);
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'cron_failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
