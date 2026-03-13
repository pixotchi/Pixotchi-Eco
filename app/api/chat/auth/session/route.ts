import { NextRequest, NextResponse } from 'next/server';
import {
  ChatAuthError,
  clearChatSessionCookie,
  clearChatSessionForRequest,
  createChatAuthRequiredResponse,
  createChatSessionResponse,
  createChatUnavailableResponse,
  getChatSessionFromRequest,
  verifyBaseChatIdentity,
  verifyFarcasterChatIdentity,
  verifyPrivyChatIdentity,
} from '@/lib/chat-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { session, sessionId } = await getChatSessionFromRequest(request);

  if (!session) {
    return createChatAuthRequiredResponse({ clearCookie: Boolean(sessionId) });
  }

  return NextResponse.json(
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
}

export async function POST(request: NextRequest) {
  let provider: unknown;

  try {
    const body = await request.json();
    provider = body?.provider;

    if (provider === 'privy') {
      const identity = await verifyPrivyChatIdentity({
        accessToken: body.accessToken,
        expectedAddress: body.expectedAddress,
        solanaAddress: body.solanaAddress,
      });
      return createChatSessionResponse(request, identity);
    }

    if (provider === 'farcaster') {
      const identity = await verifyFarcasterChatIdentity(request, {
        expectedAddress: body.expectedAddress,
        token: body.token,
      });
      return createChatSessionResponse(request, identity);
    }

    if (provider === 'base') {
      const identity = await verifyBaseChatIdentity(request, {
        address: body.address,
        message: body.message,
        signature: body.signature,
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
      if (provider === 'base' || error.status >= 500) {
        console.error('[chat-auth] Session bootstrap unavailable:', {
          status: error.status,
          message: error.message,
          provider: provider ?? 'unknown',
        });
      }

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
