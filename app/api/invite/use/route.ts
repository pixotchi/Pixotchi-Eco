import { NextRequest, NextResponse } from 'next/server';
import {
  createChatAuthRequiredResponse,
  getChatSessionFromRequest,
} from '@/lib/chat-auth';
import { markCodeAsUsed, markUserAsValidated } from '@/lib/invite-service';
import { INVITE_CONFIG } from '@/lib/invite-utils';
import { createErrorResponse } from '@/lib/auth-utils';

export async function POST(request: NextRequest) {
  try {
    // Check if invite system is enabled
    if (!INVITE_CONFIG.SYSTEM_ENABLED) {
      const error = createErrorResponse('Invite system is disabled', 403, 'SYSTEM_DISABLED');
      return NextResponse.json(error.body, { status: error.status });
    }

    const { session, sessionId } = await getChatSessionFromRequest(request);

    if (!session) {
      return createChatAuthRequiredResponse({
        clearCookie: Boolean(sessionId),
        message: 'Authentication required.',
      });
    }

    const body = await request.json();
    const { code } = body || {};

    if (!code || typeof code !== 'string') {
      const error = createErrorResponse('Invite code is required', 400, 'MISSING_CODE');
      return NextResponse.json(error.body, { status: error.status });
    }

    // Mark invite code as used
    const useResult = await markCodeAsUsed(code, session.address);

    if (!useResult.success) {
      const error = createErrorResponse(useResult.error || 'Failed to use invite code', 400, 'USE_FAILED');
      return NextResponse.json(error.body, { status: error.status });
    }

    // Mark user as validated
      const validationSuccess = await markUserAsValidated(session.address);

      if (!validationSuccess) {
        console.error('Failed to mark user as validated after using invite code');
      // Don't fail the entire request if user validation fails, just log it
    }

    return NextResponse.json({
      success: true,
      message: 'Invite code used successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in invite code usage:', error);
    const errorResponse = createErrorResponse('Internal server error', 500, 'INTERNAL_ERROR');
    return NextResponse.json(errorResponse.body, { status: errorResponse.status });
  }
} 
