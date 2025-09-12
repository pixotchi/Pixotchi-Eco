import { NextRequest, NextResponse } from 'next/server';
import { getUserInviteStats } from '@/lib/invite-service';
import { INVITE_CONFIG, formatInviteStatsMessage } from '@/lib/invite-utils';
import { createErrorResponse } from '@/lib/auth-utils';

export async function GET(request: NextRequest) {
  try {
    // Check if invite system is enabled
    if (!INVITE_CONFIG.SYSTEM_ENABLED) {
      return NextResponse.json({
        systemEnabled: false,
        message: 'Invite system is disabled',
        timestamp: new Date().toISOString(),
      });
    }

    const { searchParams } = new URL(request.url);
    const addressParam = searchParams.get('address');

    if (!addressParam) {
      const error = createErrorResponse('Address parameter is required', 400, 'MISSING_ADDRESS');
      return NextResponse.json(error.body, { status: error.status });
    }

    // Validate wallet address
    if (!addressParam.startsWith('0x')) {
      const error = createErrorResponse('Valid wallet address is required', 400, 'INVALID_ADDRESS');
      return NextResponse.json(error.body, { status: error.status });
    }

    // Get user's invite statistics
    const stats = await getUserInviteStats(addressParam);
    const message = formatInviteStatsMessage(stats);

    return NextResponse.json({
      systemEnabled: true,
      address: addressParam.toLowerCase(),
      stats,
      message,
      dailyLimit: INVITE_CONFIG.DAILY_LIMIT,
      config: {
        codeLength: INVITE_CONFIG.CODE_LENGTH,
        expiryHours: INVITE_CONFIG.EXPIRY_HOURS,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Error in invite stats API:', error);
    const errorResponse = createErrorResponse('Internal server error', 500);
    return NextResponse.json(errorResponse.body, { status: errorResponse.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Alternative endpoint that accepts address in body
    if (!INVITE_CONFIG.SYSTEM_ENABLED) {
      return NextResponse.json({
        systemEnabled: false,
        message: 'Invite system is disabled',
        timestamp: new Date().toISOString(),
      });
    }

    const body = await request.json();
    const { address } = body;

    if (!address || typeof address !== 'string' || !address.startsWith('0x')) {
      const error = createErrorResponse('Valid wallet address is required', 400, 'INVALID_ADDRESS');
      return NextResponse.json(error.body, { status: error.status });
    }

    const stats = await getUserInviteStats(address);
    const message = formatInviteStatsMessage(stats);

    return NextResponse.json({
      systemEnabled: true,
      address: address.toLowerCase(),
      stats,
      message,
      dailyLimit: INVITE_CONFIG.DAILY_LIMIT,
      config: {
        codeLength: INVITE_CONFIG.CODE_LENGTH,
        expiryHours: INVITE_CONFIG.EXPIRY_HOURS,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Error in invite stats API:', error);
    const errorResponse = createErrorResponse('Internal server error', 500);
    return NextResponse.json(errorResponse.body, { status: errorResponse.status });
  }
} 