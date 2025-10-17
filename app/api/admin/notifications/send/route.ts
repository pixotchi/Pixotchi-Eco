import { NextRequest, NextResponse } from 'next/server';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';
import { redis } from '@/lib/redis';
import { CLIENT_ENV, SERVER_ENV } from '@/lib/env-config';

const NEYNAR_NOTIFICATIONS_URL = 'https://api.neynar.com/v2/farcaster/frame/notifications/';
const MAX_TITLE_LENGTH = 32;
const MAX_BODY_LENGTH = 128;
const CHUNK_SIZE = 100;

function parseFids(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((fid) => {
      const num = typeof fid === 'string' ? Number(fid) : fid;
      return Number.isFinite(num) ? Math.floor(num) : NaN;
    })
    .filter((num) => Number.isFinite(num) && num > 0) as number[];
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

async function publishToFids(fids: number[], title: string, body: string) {
  const apiKey = SERVER_ENV.NEYNAR_API_KEY;
  if (!apiKey) {
    throw new Error('NEYNAR_API_KEY not configured');
  }

  const payload = {
    target_fids: fids,
    notification: { title, body, target_url: CLIENT_ENV.APP_URL },
  };

  const res = await fetch(NEYNAR_NOTIFICATIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = typeof json === 'object' ? JSON.stringify(json) : String(json);
    throw new Error(err || `Failed to publish notifications (${res.status})`);
  }
  return json;
}

async function recordCustomLog(entry: Record<string, unknown>, count: number) {
  if (!redis) return;
  const ts = Date.now();
  const logEntry = { ts, ...entry };
  try {
    await (redis as any)?.lpush?.('notif:custom:log', JSON.stringify(logEntry));
    await (redis as any)?.ltrim?.('notif:custom:log', 0, 49);
    await (redis as any)?.set?.('notif:custom:last', JSON.stringify(logEntry));
    await (redis as any)?.incrby?.('notif:custom:sentCount', count);
  } catch (error) {
    console.warn('[Admin Notifications] Failed to persist custom log', error);
  }
}

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!validateAdminKey(req)) {
    return NextResponse.json(createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED').body, { status: 401 });
  }

  try {
    const body = await req.json();
    const title = (body?.title ?? '').toString().trim();
    const message = (body?.body ?? '').toString().trim();
    const sendToAll = Boolean(body?.sendToAll);
    const providedFids = parseFids(body?.fids);

    if (!title || !message) {
      return NextResponse.json(createErrorResponse('Title and body are required', 400).body, { status: 400 });
    }

    if (title.length > MAX_TITLE_LENGTH) {
      return NextResponse.json(createErrorResponse(`Title must be <= ${MAX_TITLE_LENGTH} characters`, 400).body, { status: 400 });
    }
    if (message.length > MAX_BODY_LENGTH) {
      return NextResponse.json(createErrorResponse(`Body must be <= ${MAX_BODY_LENGTH} characters`, 400).body, { status: 400 });
    }

    let targetFids: number[] = [];
    if (sendToAll || providedFids.length === 0) {
      const eligible = await redis?.smembers?.('notif:eligible:fids');
      if (eligible && eligible.length > 0) {
        targetFids = eligible
          .map((value: string) => Number(value))
          .filter((fid) => Number.isFinite(fid) && fid > 0);
      }
    } else {
      targetFids = Array.from(new Set(providedFids));
    }

    if (targetFids.length === 0) {
      return NextResponse.json(createErrorResponse('No target FIDs available for notification', 400).body, { status: 400 });
    }

    const chunks = chunkArray(targetFids, CHUNK_SIZE);
    for (const chunk of chunks) {
      await publishToFids(chunk, title, message);
    }

    await recordCustomLog({ title, body: message, totalFids: targetFids.length, sendToAll: sendToAll || providedFids.length === 0, fids: sendToAll ? undefined : targetFids }, targetFids.length);

    return NextResponse.json({
      success: true,
      sent: targetFids.length,
      batches: chunks.length,
    });
  } catch (error: any) {
    return NextResponse.json(createErrorResponse(error?.message || 'Failed to send notifications', 500).body, { status: 500 });
  }
}
