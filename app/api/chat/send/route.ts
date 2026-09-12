import { NextRequest, NextResponse } from 'next/server';
import {
  storeMessage,
  validateMessage,
} from '@/lib/chat-service';
import { ChatAdmissionError } from '@/lib/chat-message-admission';
import {
  ChatAuthError,
  createChatAuthRequiredResponse,
  createChatAuthErrorResponse,
  createChatUnavailableResponse,
  getChatSessionOrQuickAuthFromRequest,
} from '@/lib/chat-auth';
import { markMissionTask, trackDailyActivity } from '@/lib/gamification-service';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';
import { getGamificationPolicy } from '@/lib/gamification-feature';

const CHAT_SEND_IP_LIMIT_PER_MINUTE = 20;
const CHAT_SEND_ADDRESS_LIMIT_PER_MINUTE = 20;

export async function POST(request: NextRequest) {
  try {
    const { session, sessionId } = await getChatSessionOrQuickAuthFromRequest(request);

    if (!session) {
      return createChatAuthRequiredResponse({ clearCookie: Boolean(sessionId) });
    }

    const body = await request.json();
    const message = typeof body?.message === 'string' ? body.message : '';
    const requestId = body?.requestId;
    if (requestId !== undefined && (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId))) {
      return NextResponse.json({ error: 'Invalid message ID' }, { status: 400 });
    }
    const senderAddress = session.address;

    if (!message.trim()) {
      return NextResponse.json(
        { error: 'Message is required' },
        {
          headers: {
            'Cache-Control': 'private, no-store',
          },
          status: 400,
        },
      );
    }

    const rateLimitResponse = await enforceRateLimit(request, {
      scope: 'api:chat:send',
      rules: [
        {
          kind: 'ip',
          identifier: getRequestIp(request),
          limit: CHAT_SEND_IP_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
        {
          kind: 'address',
          identifier: senderAddress,
          limit: CHAT_SEND_ADDRESS_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
      ],
    });

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const messageError = validateMessage(message);
    if (messageError) {
      return NextResponse.json(
        { error: messageError },
        {
          headers: {
            'Cache-Control': 'private, no-store',
          },
          status: 400,
        },
      );
    }

    let chatMessage;
    try {
      chatMessage = await storeMessage(senderAddress, message, requestId);
    } catch (error) {
      if (error instanceof ChatAdmissionError) {
        return NextResponse.json({ error: error.message }, {
          status: error.reason === 'idempotency_conflict' ? 409 : 429,
          headers: { 'Cache-Control': 'private, no-store' },
        });
      }
      console.error('Public chat message storage failed:', error);
      return createChatUnavailableResponse('Failed to store message.');
    }

    const gamificationPolicy = getGamificationPolicy();

    if (gamificationPolicy.enabled) {
      await Promise.allSettled([
        markMissionTask(senderAddress, 's2_chat_message').catch((error) => {
          console.warn('Failed to mark mission task:', error);
        }),
        trackDailyActivity(senderAddress).catch((error) => {
          console.warn('Failed to track daily activity:', error);
        }),
      ]).catch((error) => {
        console.warn('Gamification tracking failed:', error);
      });
    }

    return NextResponse.json(
      {
        message: chatMessage,
        success: true,
      },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      },
    );
  } catch (error) {
    if (error instanceof ChatAuthError) {
      return createChatAuthErrorResponse(error);
    }

    console.error('Error sending chat message:', error);
    return createChatUnavailableResponse('Failed to send message.');
  }
}
