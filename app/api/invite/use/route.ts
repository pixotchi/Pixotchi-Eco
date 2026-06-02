import { NextRequest, NextResponse } from 'next/server';
import {
  ChatAuthError,
  createChatAuthRequiredResponse,
  createChatAuthErrorResponse,
  getChatSessionOrQuickAuthFromRequest,
} from '@/lib/chat-auth';
import { redeemInviteCode } from '@/lib/invite-service';
import { INVITE_CONFIG } from '@/lib/invite-utils';
import { createErrorResponse } from '@/lib/auth-utils';

function getRedeemStatus(errorCode?: string): number {
  if (errorCode === 'ALREADY_USED' || errorCode === 'SELF_INVITE' || errorCode === 'USER_INELIGIBLE') return 403;
  if (errorCode === 'EXPIRED' || errorCode === 'NOT_FOUND') return 410;
  if (errorCode === 'REDIS_UNAVAILABLE') return 503;
  return 400;
}

export async function POST(request: NextRequest) {
  try {
    // Check if invite system is enabled
    if (!INVITE_CONFIG.SYSTEM_ENABLED) {
      const error = createErrorResponse('Invite system is disabled', 403, 'SYSTEM_DISABLED');
      return NextResponse.json(error.body, { status: error.status });
    }

    const body = await request.json();
    const { session, sessionId } = await getChatSessionOrQuickAuthFromRequest(request);

    if (!session) {
      return createChatAuthRequiredResponse({
        clearCookie: Boolean(sessionId),
        message: 'Authentication required.',
      });
    }

    const { code } = body || {};

    if (!code || typeof code !== 'string') {
      const error = createErrorResponse('Invite code is required', 400, 'MISSING_CODE');
      return NextResponse.json(error.body, { status: error.status });
    }

    const useResult = await redeemInviteCode(code, session.address);

    if (!useResult.success) {
      const error = createErrorResponse(
        useResult.error || 'Failed to use invite code',
        getRedeemStatus(useResult.errorCode),
        useResult.errorCode || 'USE_FAILED',
      );
      return NextResponse.json(error.body, { status: error.status });
    }

    return NextResponse.json({
      success: true,
      alreadyUsedByUser: Boolean(useResult.alreadyUsedByUser),
      message: 'Invite code used successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof ChatAuthError) {
      return createChatAuthErrorResponse(error);
    }

    console.error('Error in invite code usage:', error);
    const errorResponse = createErrorResponse('Internal server error', 500, 'INTERNAL_ERROR');
    return NextResponse.json(errorResponse.body, { status: errorResponse.status });
  }
} 
