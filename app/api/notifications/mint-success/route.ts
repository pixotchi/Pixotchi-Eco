import { NextRequest, NextResponse } from 'next/server';
import { sendFrameNotification } from '@/lib/notification-client';
import { SERVER_ENV } from '@/lib/env-config';
import {
  ChatAuthError,
  createChatAuthErrorResponse,
  createChatAuthRequiredResponse,
  getChatSessionOrQuickAuthFromRequest,
} from '@/lib/chat-auth';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';
import { redis } from '@/lib/redis';

const MINT_NOTIFY_IP_LIMIT_PER_MINUTE = 30;
const MINT_NOTIFY_ADDRESS_LIMIT_PER_MINUTE = 10;
const MINT_NOTIFY_FID_LIMIT_PER_MINUTE = 5;

function sanitizeStrainName(value: UntypedValue): string {
  if (typeof value !== 'string') return 'a plant';
  const trimmed = value.trim();
  if (!trimmed) return 'a plant';
  return trimmed.slice(0, 40);
}

async function logMintNotification(fid: number, address: string): Promise<void> {
  try {
    const ts = Date.now();
    await (redis as UntypedValue)?.lpush?.('notif:type:mint_success:log', JSON.stringify({ ts, fid, address }));
    await (redis as UntypedValue)?.ltrim?.('notif:type:mint_success:log', 0, 199);
    await (redis as UntypedValue)?.hset?.('notif:type:mint_success:last', { [fid]: String(ts) });
    await (redis as UntypedValue)?.incrby?.('notif:type:mint_success:sentCount', 1);
    await (redis as UntypedValue)?.sadd?.('notif:eligible:fids', String(fid));
  } catch (error) {
    console.warn('[notify/mint-success] Logging failed:', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (SERVER_ENV.NOTIFICATION_PROVIDER !== 'neynar') {
      return NextResponse.json({ success: true, skipped: true });
    }

    const { session, sessionId } = await getChatSessionOrQuickAuthFromRequest(request);
    if (!session) {
      return createChatAuthRequiredResponse({
        clearCookie: Boolean(sessionId),
        message: 'Authentication required.',
      });
    }

    const body = await request.json();
    const fid = Number(body?.fid);
    if (!Number.isSafeInteger(fid) || fid <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid fid' }, { status: 400 });
    }

    if (session.fid !== fid) {
      return NextResponse.json(
        { success: false, error: 'Authenticated Farcaster account does not match request' },
        { status: 403 },
      );
    }

    const rateLimitResponse = await enforceRateLimit(request, {
      scope: 'api:notifications:mint-success',
      rules: [
        {
          kind: 'ip',
          identifier: getRequestIp(request),
          limit: MINT_NOTIFY_IP_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
        {
          kind: 'address',
          identifier: session.address,
          limit: MINT_NOTIFY_ADDRESS_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
        {
          kind: 'address',
          identifier: `fid:${fid}`,
          limit: MINT_NOTIFY_FID_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
      ],
    });
    if (rateLimitResponse) return rateLimitResponse;

    const strainName = sanitizeStrainName(body?.strainName);
    const result = await sendFrameNotification({
      fid,
      title: 'Mint Completed!',
      body: `You minted ${strainName}. Tap to view your farm.`,
    });

    if (result.state === 'success') {
      await logMintNotification(fid, session.address.toLowerCase());
      return NextResponse.json({ success: true });
    }

    console.warn('[notify/mint-success] Notification not sent:', {
      address: session.address,
      fid,
      state: result.state,
      error: 'error' in result ? result.error : undefined,
    });

    return NextResponse.json({ success: true, skipped: true, reason: result.state });
  } catch (error) {
    if (error instanceof ChatAuthError) {
      return createChatAuthErrorResponse(error);
    }

    console.error('[notify/mint-success] Failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to process mint notification' }, { status: 500 });
  }
}
