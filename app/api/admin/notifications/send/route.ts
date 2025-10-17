import { NextRequest, NextResponse } from 'next/server';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';
import { redis } from '@/lib/redis';
import { CLIENT_ENV, SERVER_ENV } from '@/lib/env-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestPayload {
  title?: string;
  body?: string;
  type?: string;
  target?: 'all' | 'fids';
  fids?: Array<number | string>;
}

function sanitizeType(value: string | undefined): string {
  if (!value) return 'admin';
  const trimmed = value.trim();
  if (!trimmed) return 'admin';
  const sanitized = trimmed.slice(0, 32).replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  return sanitized || 'admin';
}

function normalizeFids(raw: Array<number | string> | undefined): number[] {
  if (!Array.isArray(raw)) return [];
  const parsed = raw
    .map((value) => {
      if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
      const asNumber = Number(String(value).trim());
      return Number.isFinite(asNumber) ? Math.floor(asNumber) : null;
    })
    .filter((value): value is number => value !== null && value > 0);
  return Array.from(new Set(parsed));
}

async function loadEligibleFids(): Promise<number[]> {
  const members = await redis?.smembers?.('notif:eligible:fids');
  const parsed = (members || [])
    .map((value) => Number(String(value)))
    .filter((value) => Number.isFinite(value) && value > 0);
  return Array.from(new Set(parsed.map((value) => Math.floor(value))));
}

export async function POST(request: NextRequest) {
  if (!validateAdminKey(request)) {
    const { body, status } = createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED');
    return NextResponse.json(body, { status });
  }

  let payload: RequestPayload;
  try {
    payload = await request.json();
  } catch {
    const { body, status } = createErrorResponse('Invalid JSON payload', 400, 'INVALID_JSON');
    return NextResponse.json(body, { status });
  }

  const title = (payload.title || '').trim();
  const bodyText = (payload.body || '').trim();
  if (!title || !bodyText) {
    const { body, status } = createErrorResponse('Title and body are required', 400, 'MISSING_FIELDS');
    return NextResponse.json(body, { status });
  }

  const target = payload.target === 'fids' ? 'fids' : 'all';
  let targetFids: number[] = [];

  if (target === 'fids') {
    targetFids = normalizeFids(payload.fids);
    if (targetFids.length === 0) {
      const { body, status } = createErrorResponse('Provide at least one valid fid', 400, 'NO_TARGETS');
      return NextResponse.json(body, { status });
    }
  } else {
    try {
      targetFids = await loadEligibleFids();
    } catch (error: any) {
      const { body, status } = createErrorResponse(error?.message || 'Unable to load eligible fids', 500, 'REDIS_ERROR');
      return NextResponse.json(body, { status });
    }
    if (targetFids.length === 0) {
      const { body, status } = createErrorResponse('No eligible fids available', 400, 'NO_TARGETS');
      return NextResponse.json(body, { status });
    }
  }

  const type = sanitizeType(payload.type);

  const summary = {
    total: targetFids.length,
    sent: 0,
    failed: 0,
    rateLimited: 0,
    missingToken: 0,
    errors: [] as Array<{ fid: number; reason: string }>,
  };

  const apiKey = SERVER_ENV.NEYNAR_API_KEY;
  const clientUrl = CLIENT_ENV.APP_URL;

  if (!apiKey) {
    const { body, status } = createErrorResponse('NEYNAR_API_KEY missing. Cannot deliver notifications.', 500, 'MISSING_API_KEY');
    return NextResponse.json(body, { status });
  }

  const publishToFids = async (fids: number[]) => {
    if (fids.length === 0) {
      return { ok: true, json: null } as const;
    }
    const payload = {
      target_fids: fids,
      notification: { title, body: bodyText, target_url: clientUrl },
    };

    const res = await fetch('https://api.neynar.com/v2/farcaster/frame/notifications/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, json } as const;
  };

  const CHUNK_SIZE = 500;
  for (let i = 0; i < targetFids.length; i += CHUNK_SIZE) {
    const chunk = targetFids.slice(i, i + CHUNK_SIZE);
    try {
      const result = await publishToFids(chunk);
      if (!result.ok) {
        summary.failed += chunk.length;
        const reason =
          result.json?.error ??
          result.json?.message ??
          result.json?.detail ??
          (Object.keys(result.json || {}).length > 0 ? JSON.stringify(result.json) : `publish_failed_${result?.json?.status ?? ''}`);
        chunk.forEach((fid) => {
          summary.errors.push({ fid, reason });
        });
      } else {
        summary.sent += chunk.length;
        const ts = Date.now();
        for (const fid of chunk) {
          try {
            await (redis as any)?.lpush?.('notif:global:log', JSON.stringify({ ts, fid, type }));
            await (redis as any)?.ltrim?.('notif:global:log', 0, 199);
            await (redis as any)?.hset?.('notif:global:last', { [fid]: String(ts) });
            await (redis as any)?.incrby?.('notif:global:sentCount', 1);
            await (redis as any)?.lpush?.(`notif:type:${type}:log`, JSON.stringify({ ts, fid }));
            await (redis as any)?.ltrim?.(`notif:type:${type}:log`, 0, 199);
            await (redis as any)?.hset?.(`notif:type:${type}:last`, { [fid]: String(ts) });
            await (redis as any)?.incrby?.(`notif:type:${type}:sentCount`, 1);
            await (redis as any)?.sadd?.('notif:eligible:fids', String(fid));
          } catch {}
        }
      }
    } catch (error: any) {
      summary.failed += chunk.length;
      const reason = error?.message || 'publish_failed';
      chunk.forEach((fid) => {
        summary.errors.push({ fid, reason });
      });
    }
  }

  return NextResponse.json({
    success: true,
    type,
    ...summary,
  });
}
