import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { INVITE_CONFIG } from '@/lib/invite-utils';
import { validateAdminKey, logAdminAction, createErrorResponse } from '@/lib/auth-utils';

export async function GET(request: NextRequest) {
  try {
    // Check if admin functionality is enabled
    if (!INVITE_CONFIG.ADMIN_GENERATION_ENABLED) {
      const error = createErrorResponse('Admin functionality is disabled', 403, 'ADMIN_DISABLED');
      return NextResponse.json(error.body, { status: error.status });
    }

    // Validate admin authentication using headers
    if (!validateAdminKey(request)) {
      await logAdminAction('admin_stats_failed', 'invalid_key', { reason: 'invalid_admin_key' }, false);
      const error = createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED');
      return NextResponse.json(error.body, { status: error.status });
    }

    if (!redis) {
      await logAdminAction('admin_stats_failed', 'valid_key', { reason: 'redis_unavailable' }, false);
      const error = createErrorResponse('Database not available', 500, 'REDIS_UNAVAILABLE');
      return NextResponse.json(error.body, { status: error.status });
    }

    // Get all invite codes
    const allCodeKeys = await redis.keys('pixotchi:invite-codes:*');
    const allUserKeys = await redis.keys('pixotchi:user-invites:*');
    const allValidatedKeys = await redis.keys('pixotchi:user-validated:*');
    
    console.log('Admin stats debug - Found keys:', {
      codeKeys: allCodeKeys.length,
      userKeys: allUserKeys.length,
      validatedKeys: allValidatedKeys.length,
      sampleCodeKeys: allCodeKeys.slice(0, 3),
    });
    
    // Debug first code to see data structure
    if (allCodeKeys.length > 0) {
      try {
        const firstCodeData = await redis.get(allCodeKeys[0]);
        console.log('First code data type:', typeof firstCodeData);
        console.log('First code data sample:', firstCodeData);
      } catch (error) {
        console.error('Error getting first code for debug:', error);
      }
    }

    const codeStats = {
      total: 0,
      used: 0,
      active: 0,
      expired: 0,
      byDate: {} as Record<string, number>,
    };

    const userStats = {
      totalUsers: allUserKeys.length,
      validatedUsers: allValidatedKeys.length,
      topGenerators: [] as Array<{address: string, generated: number, used: number}>,
    };

    // Analyze codes
    const codes = [];
    for (const key of allCodeKeys) {
      try {
        const data = await redis.get(key);
        if (data) {
          // Handle both string and object responses from Redis
          let codeData;
          if (typeof data === 'string') {
            try {
              codeData = JSON.parse(data);
            } catch (parseError) {
              console.error('Failed to parse JSON string:', data, parseError);
              continue;
            }
          } else if (typeof data === 'object' && data !== null) {
            // Redis returned an object directly
            codeData = data;
          } else {
            console.error('Unexpected data type from Redis:', typeof data, data);
            continue;
          }
          
          codes.push(codeData);
          
          codeStats.total++;
          if (codeData.isUsed) {
            codeStats.used++;
          } else if (codeData.expiresAt && Date.now() > codeData.expiresAt) {
            codeStats.expired++;
          } else {
            codeStats.active++;
          }
          
          // Group by date
          const date = new Date(codeData.createdAt).toISOString().split('T')[0];
          codeStats.byDate[date] = (codeStats.byDate[date] || 0) + 1;
        }
      } catch (error) {
        console.error('Error processing code data for key:', key, 'error:', error);
      }
    }

    // Analyze users (get top generators)
    const userGenerationMap = new Map<string, {generated: number, used: number}>();
    
    for (const key of allUserKeys) {
      try {
        const data = await redis.get(key);
        if (data) {
          // Handle both string and object responses from Redis
          let userData;
          if (typeof data === 'string') {
            try {
              userData = JSON.parse(data);
            } catch (parseError) {
              console.error('Failed to parse user JSON string:', data, parseError);
              continue;
            }
          } else if (typeof data === 'object' && data !== null) {
            // Redis returned an object directly
            userData = data;
          } else {
            console.error('Unexpected user data type from Redis:', typeof data, data);
            continue;
          }
          
          userGenerationMap.set(userData.address, {
            generated: userData.totalCodesGenerated || 0,
            used: userData.totalCodesUsed || 0,
          });
        }
      } catch (error) {
        console.error('Error processing user data for key:', key, 'error:', error);
      }
    }

    // Sort and get top 10 generators
    userStats.topGenerators = Array.from(userGenerationMap.entries())
      .map(([address, stats]) => ({
        address: `${address.substring(0, 6)}...${address.substring(address.length - 4)}`, // Truncate for privacy
        generated: stats.generated,
        used: stats.used,
      }))
      .sort((a, b) => b.generated - a.generated)
      .slice(0, 10);

    const recentCodes = codes
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map(code => ({
        code: code.code,
        createdAt: code.createdAt,
        isUsed: code.isUsed,
        createdBy: code.createdBy === '0x0000000000000000000000000000000000000001' ? 'admin' : 'user',
        usedBy: code.usedBy ? `${code.usedBy.substring(0, 6)}...${code.usedBy.substring(code.usedBy.length - 4)}` : null,
      }));

    console.log('Admin stats final results:', {
      codeStats,
      userStats,
      recentCodesCount: recentCodes.length,
      totalCodesProcessed: codes.length,
    });

    // Log successful admin action
    await logAdminAction('admin_stats_success', 'valid_key', { 
      totalCodes: codeStats.total,
      totalUsers: userStats.totalUsers,
      validatedUsers: userStats.validatedUsers 
    }, true);

    return NextResponse.json({
      success: true,
      codes: codeStats,
      users: userStats,
      recentCodes,
      systemInfo: {
        dailyLimit: INVITE_CONFIG.DAILY_LIMIT,
        expiryHours: INVITE_CONFIG.EXPIRY_HOURS,
        systemEnabled: INVITE_CONFIG.SYSTEM_ENABLED,
      },
    });

  } catch (error) {
    console.error('Error getting admin stats:', error);
    await logAdminAction('admin_stats_failed', 'unknown', { reason: 'internal_error' }, false);
    const errorResponse = createErrorResponse('Internal server error', 500);
    return NextResponse.json(errorResponse.body, { status: errorResponse.status });
  }
} 