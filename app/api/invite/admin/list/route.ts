import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { RedisKeys } from '@/lib/invite-utils';
import { InviteCode } from '@/lib/types';
import { validateAdminKey, logAdminAction, createErrorResponse } from '@/lib/auth-utils';

export async function GET(request: NextRequest) {
  try {
    // Validate admin authentication using headers
    if (!validateAdminKey(request)) {
      await logAdminAction('admin_list_failed', 'invalid_key', { reason: 'invalid_admin_key' }, false);
      const error = createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED');
      return NextResponse.json(error.body, { status: error.status });
    }

    if (!redis) {
      await logAdminAction('admin_list_failed', 'valid_key', { reason: 'redis_unavailable' }, false);
      const error = createErrorResponse('Database not available', 500, 'REDIS_UNAVAILABLE');
      return NextResponse.json(error.body, { status: error.status });
    }

    // Get all invite code keys
    const keys = await redis.keys('pixotchi:invite-codes:*');
    const codes: any[] = [];

    // Fetch details for each code
    for (const key of keys) {
      try {
        const data = await redis.get(key);
        if (data) {
          const inviteCode: InviteCode = JSON.parse(data as string);
          codes.push({
            code: inviteCode.code,
            createdBy: inviteCode.createdBy,
            createdAt: new Date(inviteCode.createdAt).toISOString(),
            isUsed: inviteCode.isUsed,
            usedBy: inviteCode.usedBy,
            usedAt: inviteCode.usedAt ? new Date(inviteCode.usedAt).toISOString() : null,
            expiresAt: inviteCode.expiresAt ? new Date(inviteCode.expiresAt).toISOString() : null,
            isExpired: inviteCode.expiresAt ? Date.now() > inviteCode.expiresAt : false
          });
        }
      } catch (parseError) {
        console.error('Error parsing invite code:', parseError);
      }
    }

    // Sort by creation date (newest first)
    codes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Log successful admin action
    await logAdminAction('admin_list_success', 'valid_key', { 
      totalCodes: codes.length,
      activeCodes: codes.filter(c => !c.isUsed && !c.isExpired).length,
      usedCodes: codes.filter(c => c.isUsed).length,
      expiredCodes: codes.filter(c => c.isExpired && !c.isUsed).length
    }, true);

    return NextResponse.json({
      success: true,
      totalCodes: codes.length,
      activeCodes: codes.filter(c => !c.isUsed && !c.isExpired).length,
      usedCodes: codes.filter(c => c.isUsed).length,
      expiredCodes: codes.filter(c => c.isExpired && !c.isUsed).length,
      codes
    });

  } catch (error) {
    console.error('Error in admin list codes:', error);
    await logAdminAction('admin_list_failed', 'unknown', { reason: 'internal_error' }, false);
    const errorResponse = createErrorResponse('Internal server error', 500);
    return NextResponse.json(errorResponse.body, { status: errorResponse.status });
  }
}

export async function POST(request: NextRequest) {
  const error = createErrorResponse('Use GET method to list codes', 405);
  return NextResponse.json(error.body, { status: error.status });
} 