import { NextRequest, NextResponse } from 'next/server';
import {
  createChatAuthRequiredResponse,
  createChatUnavailableResponse,
  getChatSessionOrMiniAppBypassFromRequest,
} from '@/lib/chat-auth';
import { getRecentMessages } from '@/lib/chat-service';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';

const CHAT_READ_IP_LIMIT_PER_MINUTE = 120;
const CHAT_READ_ADDRESS_LIMIT_PER_MINUTE = 240;

export async function GET(request: NextRequest) {
  try {
    const { session, sessionId } = await getChatSessionOrMiniAppBypassFromRequest(request);

    if (!session) {
      return createChatAuthRequiredResponse({ clearCookie: Boolean(sessionId) });
    }

    const rateLimitResponse = await enforceRateLimit(request, {
      scope: 'api:chat:messages',
      rules: [
        {
          kind: 'ip',
          identifier: getRequestIp(request),
          limit: CHAT_READ_IP_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
        {
          kind: 'address',
          identifier: session.address,
          limit: CHAT_READ_ADDRESS_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
      ],
    });

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    if (!Number.isFinite(limit) || limit < 1) {
      return NextResponse.json(
        { error: 'Limit must be a positive number.' },
        {
          headers: {
            'Cache-Control': 'private, no-store',
          },
          status: 400,
        },
      );
    }

    if (limit > 100) {
      return NextResponse.json(
        { error: 'Limit cannot exceed 100' },
        {
          headers: {
            'Cache-Control': 'private, no-store',
          },
          status: 400,
        },
      );
    }

    const messages = await getRecentMessages(limit);

    return NextResponse.json(
      {
        count: messages.length,
        messages,
        timestamp: Date.now(),
      },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      },
    );
  } catch (error) {
    console.error('Error fetching chat messages:', error);
    return createChatUnavailableResponse('Failed to fetch messages.');
  }
}
