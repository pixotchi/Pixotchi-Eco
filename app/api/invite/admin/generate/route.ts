import { NextRequest, NextResponse } from 'next/server';
import { generateSecureCode } from '@/lib/invite-utils';
import { redis } from '@/lib/redis';
import { INVITE_CONFIG, RedisKeys } from '@/lib/invite-utils';
import { InviteCode } from '@/lib/types';
import { validateAdminKey, logAdminAction, createErrorResponse } from '@/lib/auth-utils';

export async function POST(request: NextRequest) {
  try {
    // Check if admin functionality is enabled
    if (!INVITE_CONFIG.ADMIN_GENERATION_ENABLED) {
      const error = createErrorResponse('Admin generation is disabled', 403, 'ADMIN_DISABLED');
      return NextResponse.json(error.body, { status: error.status });
    }

    // Validate admin authentication using headers
    if (!validateAdminKey(request)) {
      await logAdminAction('admin_generate_failed', 'invalid_key', { reason: 'invalid_admin_key' }, false);
      const error = createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED');
      return NextResponse.json(error.body, { status: error.status });
    }

    const body = await request.json();
    const { count = 1 } = body;

    // Validate count
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      await logAdminAction('admin_generate_failed', 'valid_key', { reason: 'invalid_count', count }, false);
      const error = createErrorResponse('Count must be between 1 and 50', 400, 'INVALID_COUNT');
      return NextResponse.json(error.body, { status: error.status });
    }

    if (!redis) {
      await logAdminAction('admin_generate_failed', 'valid_key', { reason: 'redis_unavailable' }, false);
      const error = createErrorResponse('Database not available', 500, 'REDIS_UNAVAILABLE');
      return NextResponse.json(error.body, { status: error.status });
    }

    // System address for admin-generated codes
    const systemAddress = '0x0000000000000000000000000000000000000001';
    const now = Date.now();
    const expiresAt = now + (INVITE_CONFIG.EXPIRY_HOURS * 60 * 60 * 1000);

    const generatedCodes = [];

    // Generate multiple codes
    for (let i = 0; i < count; i++) {
      const code = generateSecureCode();
      
      const inviteCode: InviteCode = {
        code,
        createdBy: systemAddress,
        createdAt: now,
        isUsed: false,
        expiresAt,
      };

      // Store in Redis
      const codeKey = RedisKeys.inviteCode(code);
      await redis.set(codeKey, JSON.stringify(inviteCode));
      
      generatedCodes.push(code);
    }

    // Log successful admin action
    await logAdminAction('admin_generate_success', 'valid_key', { 
      codesGenerated: generatedCodes.length,
      expiresAt 
    }, true);

    return NextResponse.json({
      success: true,
      codes: generatedCodes,
      count: generatedCodes.length,
      message: `Generated ${generatedCodes.length} admin invite codes`,
      expiresAt,
    });

  } catch (error) {
    console.error('Error generating admin invite codes:', error);
    await logAdminAction('admin_generate_failed', 'unknown', { reason: 'internal_error' }, false);
    const errorResponse = createErrorResponse('Failed to generate admin codes', 500, 'GENERATION_FAILED');
    return NextResponse.json(errorResponse.body, { status: errorResponse.status });
  }
} 