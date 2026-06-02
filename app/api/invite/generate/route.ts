import { NextRequest, NextResponse } from 'next/server';
import {
  ChatAuthError,
  createChatAuthRequiredResponse,
  createChatAuthErrorResponse,
  getChatSessionOrQuickAuthFromRequest,
} from '@/lib/chat-auth';
import { generateInviteCode } from '@/lib/invite-service';
import { INVITE_CONFIG } from '@/lib/invite-utils';
import { createErrorResponse } from '@/lib/auth-utils';

function getGenerationStatus(errorCode?: string): number {
  if (errorCode === 'USER_NOT_VALIDATED' || errorCode === 'USER_INELIGIBLE') return 403;
  if (errorCode === 'DAILY_LIMIT_EXCEEDED') return 429;
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

    const { session, sessionId } = await getChatSessionOrQuickAuthFromRequest(request);

    if (!session) {
      return createChatAuthRequiredResponse({
        clearCookie: Boolean(sessionId),
        message: 'Authentication required.',
      });
    }

    const result = await generateInviteCode(session.address);

    if (result.success) {
    return NextResponse.json({
      success: true,
      code: result.code,
      message: 'Invite code generated successfully',
        timestamp: new Date().toISOString(),
    });
    } else {
      const error = createErrorResponse(
        result.error || 'Failed to generate invite code',
        getGenerationStatus(result.errorCode),
        result.errorCode || 'GENERATION_FAILED',
      );
      return NextResponse.json(error.body, { status: error.status });
    }
  } catch (error) {
    if (error instanceof ChatAuthError) {
      return createChatAuthErrorResponse(error);
    }

    console.error('Error in invite generation:', error);
    const errorResponse = createErrorResponse('Internal server error', 500, 'INTERNAL_ERROR');
    return NextResponse.json(errorResponse.body, { status: errorResponse.status });
  }
} 
