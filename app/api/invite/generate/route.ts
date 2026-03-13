import { NextRequest, NextResponse } from 'next/server';
import {
  createChatAuthRequiredResponse,
  getChatSessionOrMiniAppBypassFromRequest,
} from '@/lib/chat-auth';
import { generateInviteCode } from '@/lib/invite-service';
import { INVITE_CONFIG } from '@/lib/invite-utils';
import { createErrorResponse } from '@/lib/auth-utils';

export async function POST(request: NextRequest) {
  try {
    // Check if invite system is enabled
    if (!INVITE_CONFIG.SYSTEM_ENABLED) {
      const error = createErrorResponse('Invite system is disabled', 403, 'SYSTEM_DISABLED');
      return NextResponse.json(error.body, { status: error.status });
    }

    const body = await request.json().catch(() => ({}));
    const fallbackAddress = typeof body?.address === 'string' ? body.address : null;
    const { session, sessionId } = await getChatSessionOrMiniAppBypassFromRequest(request, {
      fallbackAddress,
    });

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
      const error = createErrorResponse(result.error || 'Failed to generate invite code', 400, 'GENERATION_FAILED');
      return NextResponse.json(error.body, { status: error.status });
    }
  } catch (error) {
    console.error('Error in invite generation:', error);
    const errorResponse = createErrorResponse('Internal server error', 500, 'INTERNAL_ERROR');
    return NextResponse.json(errorResponse.body, { status: errorResponse.status });
  }
} 
