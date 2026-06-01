import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  checkSpam,
  storeMessage,
  updateRateLimit,
  validateMessage,
} from '@/lib/chat-service';
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

    const canSend = await checkRateLimit(senderAddress);
    if (!canSend) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait before sending another message.' },
        {
          headers: {
            'Cache-Control': 'private, no-store',
          },
          status: 429,
        },
      );
    }

    const isSpam = await checkSpam(message, senderAddress);
    if (isSpam) {
      return NextResponse.json(
        { error: 'Duplicate or spam message detected' },
        {
          headers: {
            'Cache-Control': 'private, no-store',
          },
          status: 429,
        },
      );
    }

    let chatMessage;
    try {
      chatMessage = await storeMessage(senderAddress, message);
    } catch (error) {
      console.error('Public chat message storage failed:', error);
      return createChatUnavailableResponse('Failed to store message.');
    }

    try {
      const updatePromise = updateRateLimit(senderAddress);
      let timeoutId: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Rate limit update timeout')), 3000);
      });

      await Promise.race([updatePromise, timeoutPromise]);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      console.error('Public chat rate limit update failed:', error);
    }

    const gamificationPolicy = getGamificationPolicy();

    if (gamificationPolicy.enabled) {
      Promise.allSettled([
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
