import { NextRequest, NextResponse } from 'next/server';
import { ChatAuthError, createChatUnavailableResponse, issueBaseAuthNonce } from '@/lib/chat-auth';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';

export const dynamic = 'force-dynamic';

const BASE_NONCE_IP_LIMIT_PER_MINUTE = 30;

export async function GET(request: NextRequest) {
  const rateLimitResponse = await enforceRateLimit(request, {
    scope: 'api:chat:auth:base:nonce',
    rules: [
      {
        kind: 'ip',
        identifier: getRequestIp(request),
        limit: BASE_NONCE_IP_LIMIT_PER_MINUTE,
        windowSeconds: 60,
      },
    ],
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const nonce = await issueBaseAuthNonce();

    return NextResponse.json(
      { nonce },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      },
    );
  } catch (error) {
    if (error instanceof ChatAuthError) {
      return createChatUnavailableResponse(error.message);
    }

    console.error('[chat-auth] Failed to issue Base nonce:', error);
    return createChatUnavailableResponse('Failed to create Base authentication nonce.');
  }
}
