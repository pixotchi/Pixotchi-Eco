import { NextRequest, NextResponse } from 'next/server';
import { validateInviteCode } from '@/lib/invite-service';
import { INVITE_CONFIG } from '@/lib/invite-utils';
import { createErrorResponse } from '@/lib/auth-utils';

export async function POST(request: NextRequest) {
  try {
    // Check if invite system is enabled
    if (!INVITE_CONFIG.SYSTEM_ENABLED) {
      return NextResponse.json({ 
          valid: true, 
        message: 'Invite system is disabled - access granted',
        timestamp: new Date().toISOString(),
      });
    }

    const body = await request.json();
    const { code } = body;

    if (!code || typeof code !== 'string') {
      const error = createErrorResponse('Invite code is required', 400, 'MISSING_CODE');
      return NextResponse.json(error.body, { status: error.status });
    }

    // Validate invite code using existing service
    const result = await validateInviteCode(code);

    return NextResponse.json({
      valid: result.valid,
      message: result.valid ? 'Valid invite code' : (result.error || 'Invalid invite code'),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in invite validation:', error);
    const errorResponse = createErrorResponse('Internal server error', 500, 'INTERNAL_ERROR');
    return NextResponse.json(errorResponse.body, { status: errorResponse.status });
  }
} 