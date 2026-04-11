import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';
import { redis } from '@/lib/redis';
import { SERVER_ENV } from '@/lib/env-config';

const MAP_FID_IP_LIMIT_PER_MINUTE = 60;

export async function POST(req: NextRequest) {
  try {
    if (SERVER_ENV.NOTIFICATION_PROVIDER !== 'neynar') {
      return NextResponse.json({ success: true, skipped: true });
    }

    const rateLimitResponse = await enforceRateLimit(req, {
      scope: 'api:notifications:map-fid',
      rules: [
        {
          kind: 'ip',
          identifier: getRequestIp(req),
          limit: MAP_FID_IP_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
      ],
    });

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const { fid, address } = await req.json();
    if (typeof fid !== 'number' || !address || typeof address !== 'string') {
      return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
    }
    if (!redis) return NextResponse.json({ success: false, error: 'Redis unavailable' }, { status: 500 });
    await redis.set(`fidmap:${fid}`, address.toLowerCase());
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'failed' }, { status: 500 });
  }
}


