import { NextRequest, NextResponse } from 'next/server';
import {
  getAIConversationForAddress,
  getAIConversationMessages,
  getOrCreateConversation,
  stripAIMessageDebugMetadata,
} from '@/lib/ai-service';
import {
  createChatAuthRequiredResponse,
  createChatUnavailableResponse,
  getChatSessionOrMiniAppBypassFromRequest,
} from '@/lib/chat-auth';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';

export const dynamic = 'force-dynamic';

const AI_CHAT_READ_IP_LIMIT_PER_MINUTE = 120;
const AI_CHAT_READ_ADDRESS_LIMIT_PER_MINUTE = 240;

export async function GET(request: NextRequest) {
  try {
    const { session, sessionId } = await getChatSessionOrMiniAppBypassFromRequest(request);

    if (!session) {
      return createChatAuthRequiredResponse({ clearCookie: Boolean(sessionId) });
    }

    const rateLimitResponse = await enforceRateLimit(request, {
      scope: 'api:chat:ai:messages',
      rules: [
        {
          kind: 'ip',
          identifier: getRequestIp(request),
          limit: AI_CHAT_READ_IP_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
        {
          kind: 'address',
          identifier: session.address,
          limit: AI_CHAT_READ_ADDRESS_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
      ],
    });

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');
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

    let finalConversationId = conversationId;

    if (!finalConversationId) {
      finalConversationId = await getOrCreateConversation(session.address);
    } else {
      const conversation = await getAIConversationForAddress(session.address, finalConversationId);
      if (!conversation) {
        return NextResponse.json(
          { error: 'Conversation not found.' },
          {
            headers: {
              'Cache-Control': 'private, no-store',
            },
            status: 404,
          },
        );
      }
    }

    const messages = await getAIConversationMessages(finalConversationId, limit);
    const publicMessages = messages.map(stripAIMessageDebugMetadata);

    return NextResponse.json(
      {
        messages: publicMessages,
        conversationId: finalConversationId,
        count: publicMessages.length,
        timestamp: Date.now(),
      },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      },
    );
  } catch (error) {
    console.error('Error fetching AI chat messages:', error);
    return createChatUnavailableResponse('Failed to fetch AI messages.');
  }
}
