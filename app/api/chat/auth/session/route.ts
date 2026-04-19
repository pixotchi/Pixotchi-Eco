import { NextRequest, NextResponse } from 'next/server';
import {
  ChatAuthError,
  clearChatSessionCookie,
  clearChatSessionForRequest,
  createChatAuthRequiredResponse,
  createChatSessionResponse,
  createChatUnavailableResponse,
  getChatSessionFromRequest,
  setChatSessionCookie,
  verifyBaseChatIdentity,
  verifyFarcasterChatIdentity,
  verifyPrivyChatIdentity,
} from '@/lib/chat-auth';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';

export const dynamic = 'force-dynamic';

const CHAT_AUTH_SESSION_GET_IP_LIMIT_PER_MINUTE = 60;
const CHAT_AUTH_SESSION_GET_ADDRESS_LIMIT_PER_MINUTE = 90;
const CHAT_AUTH_SESSION_POST_IP_LIMIT_PER_MINUTE = 20;
const CHAT_AUTH_SESSION_POST_ADDRESS_LIMIT_PER_MINUTE = 10;
const CHAT_AUTH_SESSION_DELETE_IP_LIMIT_PER_MINUTE = 20;

function getStringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' ? value : undefined;
}

function getRequestedChatAuthAddress(body: unknown, provider: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const payload = body as Record<string, unknown>;

  if (provider === 'base' && typeof payload.address === 'string') {
    return payload.address;
  }

  if (provider === 'privy' && typeof payload.expectedAddress === 'string') {
    return payload.expectedAddress;
  }

  return null;
}

export async function GET(request: NextRequest) {
  const ipRateLimitResponse = await enforceRateLimit(request, {
    scope: 'api:chat:auth:session:get',
    rules: [
      {
        kind: 'ip',
        identifier: getRequestIp(request),
        limit: CHAT_AUTH_SESSION_GET_IP_LIMIT_PER_MINUTE,
        windowSeconds: 60,
      },
    ],
  });

  if (ipRateLimitResponse) {
    return ipRateLimitResponse;
  }

  const { session, sessionId } = await getChatSessionFromRequest(request);

  if (session) {
    const addressRateLimitResponse = await enforceRateLimit(request, {
      scope: 'api:chat:auth:session:get',
      rules: [
        {
          kind: 'address',
          identifier: session.address,
          limit: CHAT_AUTH_SESSION_GET_ADDRESS_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
      ],
    });

    if (addressRateLimitResponse) {
      return addressRateLimitResponse;
    }
  }

  if (!session) {
    return createChatAuthRequiredResponse({ clearCookie: Boolean(sessionId) });
  }

  const response = NextResponse.json(
    {
      address: session.address,
      authenticated: true,
      method: session.method,
      provider: session.provider,
      ...(session.sourceAddress ? { sourceAddress: session.sourceAddress } : {}),
    },
    {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    },
  );

  setChatSessionCookie(response, session.id);
  return response;
}

export async function POST(request: NextRequest) {
  let provider: unknown;

  try {
    const parsedBody = await request.json();
    const body = parsedBody && typeof parsedBody === 'object'
      ? parsedBody as Record<string, unknown>
      : {};
    provider = body?.provider;

    const rateLimitResponse = await enforceRateLimit(request, {
      scope: 'api:chat:auth:session:post',
      rules: [
        {
          kind: 'ip',
          identifier: getRequestIp(request),
          limit: CHAT_AUTH_SESSION_POST_IP_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
        {
          kind: 'address',
          identifier: getRequestedChatAuthAddress(body, provider),
          limit: CHAT_AUTH_SESSION_POST_ADDRESS_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
      ],
    });

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    if (provider === 'privy') {
      const identity = await verifyPrivyChatIdentity({
        accessToken: getStringField(body, 'accessToken') ?? '',
        expectedAddress: getStringField(body, 'expectedAddress') ?? null,
        solanaAddress: getStringField(body, 'solanaAddress') ?? null,
      });
      return createChatSessionResponse(request, identity);
    }

    if (provider === 'farcaster') {
      const identity = await verifyFarcasterChatIdentity(request, {
        expectedAddress: getStringField(body, 'expectedAddress') ?? null,
        token: getStringField(body, 'token') ?? '',
      });
      return createChatSessionResponse(request, identity);
    }

    if (provider === 'base') {
      const identity = await verifyBaseChatIdentity(request, {
        address: getStringField(body, 'address') ?? '',
        message: getStringField(body, 'message') ?? '',
        signature: (getStringField(body, 'signature') ?? '0x') as `0x${string}`,
      });
      return createChatSessionResponse(request, identity);
    }

    return NextResponse.json(
      { error: 'Unsupported chat auth provider.' },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
        status: 400,
      },
    );
  } catch (error) {
    if (error instanceof ChatAuthError) {
      if (error.status === 503) {
        return createChatUnavailableResponse(error.message);
      }

      return NextResponse.json(
        { error: error.message },
        {
          headers: {
            'Cache-Control': 'private, no-store',
          },
          status: error.status,
        },
      );
    }

    console.error('[chat-auth] Failed to create chat session:', error);
    return createChatUnavailableResponse();
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, {
      scope: 'api:chat:auth:session:delete',
      rules: [
        {
          kind: 'ip',
          identifier: getRequestIp(request),
          limit: CHAT_AUTH_SESSION_DELETE_IP_LIMIT_PER_MINUTE,
          windowSeconds: 60,
        },
      ],
    });

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    await clearChatSessionForRequest(request);

    const response = NextResponse.json(
      { cleared: true },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      },
    );

    clearChatSessionCookie(response);
    return response;
  } catch (error) {
    console.error('[chat-auth] Failed to clear chat session:', error);
    return createChatUnavailableResponse('Failed to clear public chat session.');
  }
}
