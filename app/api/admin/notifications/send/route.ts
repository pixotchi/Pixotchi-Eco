import { NextRequest, NextResponse } from 'next/server';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';
import { redis } from '@/lib/redis';
import { sendFrameNotification } from '@/lib/notification-client';

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

  for (const fid of targetFids) {
    try {
      const result = await sendFrameNotification({ fid, title, body: bodyText });
      if (result.state === 'success') {
        summary.sent += 1;
        try {
          const ts = Date.now();
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
      } else if (result.state === 'rate_limit') {
        summary.rateLimited += 1;
        summary.errors.push({ fid, reason: 'rate_limited' });
      } else if (result.state === 'no_token') {
        summary.missingToken += 1;
        summary.errors.push({ fid, reason: 'no_token' });
      } else {
        summary.failed += 1;
        summary.errors.push({ fid, reason: 'error' });
      }
    } catch (error: any) {
      summary.failed += 1;
      summary.errors.push({ fid, reason: error?.message || 'error' });
    }
  }

  return NextResponse.json({
    success: true,
    type,
    ...summary,
  });
}
