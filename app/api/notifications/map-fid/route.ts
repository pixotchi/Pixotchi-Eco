import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';
import { redis } from '@/lib/redis';
import { SERVER_ENV } from '@/lib/env-config';
import {
  ChatAuthError,
  getFarcasterQuickAuthTokenFromRequest,
  verifyFarcasterChatIdentity,
} from '@/lib/chat-auth';
import { isAddress } from 'viem';

const MAP_FID_IP_LIMIT_PER_MINUTE = 60;
const MAP_FID_IDENTITY_LIMIT_PER_MINUTE = 20;
const FID_MAP_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function POST(req: NextRequest) {
  try {
    if (SERVER_ENV.NOTIFICATION_PROVIDER !== 'neynar') {
      return NextResponse.json({ success: true, skipped: true });
    }

    const body = await req.json();
    const fid = Number(body?.fid);
    const address = body?.address;

    if (!Number.isSafeInteger(fid) || fid <= 0 || !address || typeof address !== 'string' || !isAddress(address)) {
      return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
    }

    const normalizedAddress = address.toLowerCase();
    const rateLimitResponse = await enforceRateLimit(req, {
      scope: 'api:notifications:map-fid',
      rules: [
        {
          kind: 'ip',
          identifier: getRequestIp(req),
          limit: MAP_FID_IP_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
        {
          kind: 'address',
          identifier: `fid:${fid}`,
          limit: MAP_FID_IDENTITY_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
        {
          kind: 'address',
          identifier: normalizedAddress,
          limit: MAP_FID_IDENTITY_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
      ],
    });

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const token = getFarcasterQuickAuthTokenFromRequest(req);
    if (!token) {
      return NextResponse.json({ success: false, error: 'Farcaster Quick Auth token is required' }, { status: 401 });
    }

    const identity = await verifyFarcasterChatIdentity(req, {
      token,
      expectedAddress: normalizedAddress,
    });

    if (identity.fid !== fid) {
      return NextResponse.json({ success: false, error: 'Authenticated FID does not match request' }, { status: 403 });
    }

    if (identity.address.toLowerCase() !== normalizedAddress) {
      return NextResponse.json({ success: false, error: 'Authenticated wallet does not match request' }, { status: 403 });
    }

    if (!redis) return NextResponse.json({ success: false, error: 'Redis unavailable' }, { status: 500 });
    await redis.set(`fidmap:${fid}`, normalizedAddress, { ex: FID_MAP_TTL_SECONDS });
    return NextResponse.json({ success: true });
  } catch (e: UntypedValue) {
    if (e instanceof ChatAuthError) {
      return NextResponse.json({ success: false, error: e.message }, { status: e.status });
    }
    return NextResponse.json({ success: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
