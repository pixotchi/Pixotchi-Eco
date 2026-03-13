import { NextRequest, NextResponse } from 'next/server';
import { sendAIMessage, validateAIMessage } from '@/lib/ai-service';
import {
  createChatAuthRequiredResponse,
  createChatUnavailableResponse,
  getChatSessionOrMiniAppBypassFromRequest,
} from '@/lib/chat-auth';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const AI_CHAT_IP_LIMIT_PER_MINUTE = 30;
const AI_CHAT_ADDRESS_COOLDOWN_SECONDS = 10;

export async function POST(request: NextRequest) {
  try {
    const { session, sessionId } = await getChatSessionOrMiniAppBypassFromRequest(request);

    if (!session) {
      return createChatAuthRequiredResponse({ clearCookie: Boolean(sessionId) });
    }

    const body = await request.json();
    const message = typeof body?.message === 'string' ? body.message : '';

    const messageError = validateAIMessage(message);
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

    const rateLimitResponse = await enforceRateLimit(request, {
      scope: 'api:chat:ai:send',
      rules: [
        {
          kind: 'ip',
          identifier: getRequestIp(request),
          limit: AI_CHAT_IP_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
        {
          kind: 'address',
          identifier: session.address,
          limit: 1,
          windowSeconds: AI_CHAT_ADDRESS_COOLDOWN_SECONDS,
        },
      ],
    });

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const result = await sendAIMessage(session.address, message);

    return NextResponse.json(
      {
        success: true,
        userMessage: result.userMessage,
        aiResponse: result.aiResponse,
        conversationId: result.userMessage.conversationId,
      },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      },
    );
  } catch (error) {
    console.error('Error in AI chat endpoint:', error);
    return createChatUnavailableResponse('Failed to process AI message.');
  }
}
