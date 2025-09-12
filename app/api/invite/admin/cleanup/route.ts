import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { INVITE_CONFIG } from '@/lib/invite-utils';
import { validateAdminKey, logAdminAction, createErrorResponse } from '@/lib/auth-utils';

export async function POST(request: NextRequest) {
  try {
    // Check if admin functionality is enabled
    if (!INVITE_CONFIG.ADMIN_GENERATION_ENABLED) {
      const error = createErrorResponse('Admin functionality is disabled', 403, 'ADMIN_DISABLED');
      return NextResponse.json(error.body, { status: error.status });
    }

    // Validate admin authentication using headers
    if (!validateAdminKey(request)) {
      await logAdminAction('admin_cleanup_failed', 'invalid_key', { reason: 'invalid_admin_key' }, false);
      const error = createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED');
      return NextResponse.json(error.body, { status: error.status });
    }

    const body = await request.json();
    const { action, target } = body;
    
    if (!redis) {
      await logAdminAction('admin_cleanup_failed', 'valid_key', { reason: 'redis_unavailable' }, false);
      const error = createErrorResponse('Database not available', 500, 'REDIS_UNAVAILABLE');
      return NextResponse.json(error.body, { status: error.status });
    }

    let result = { success: false, message: '', deleted: 0 };

    switch (action) {
      case 'delete_expired_codes': {
        const keys = await redis.keys('pixotchi:invite-codes:*');
        let deleted = 0;
        
        for (const key of keys) {
          try {
            const data = await redis.get(key);
            if (data) {
              const codeData = JSON.parse(data as string);
              if (codeData.expiresAt && Date.now() > codeData.expiresAt) {
                await redis.del(key);
                deleted++;
              }
            }
          } catch (error) {
            console.error('Error processing key:', key, error);
          }
        }
        
        result = { success: true, message: `Deleted ${deleted} expired codes`, deleted };
        await logAdminAction('admin_cleanup_expired', 'valid_key', { deleted }, true);
        break;
      }

      case 'delete_used_codes': {
        const keys = await redis.keys('pixotchi:invite-codes:*');
        let deleted = 0;
        
        for (const key of keys) {
          try {
            const data = await redis.get(key);
            if (data) {
              const codeData = JSON.parse(data as string);
              if (codeData.isUsed) {
                await redis.del(key);
                deleted++;
              }
            }
          } catch (error) {
            console.error('Error processing key:', key, error);
          }
        }
        
        result = { success: true, message: `Deleted ${deleted} used codes`, deleted };
        await logAdminAction('admin_cleanup_used', 'valid_key', { deleted }, true);
        break;
      }

      case 'delete_all_codes': {
        const keys = await redis.keys('pixotchi:invite-codes:*');
        if (keys.length > 0) {
          await redis.del(...keys);
        }
        
        result = { success: true, message: `Deleted ${keys.length} invite codes`, deleted: keys.length };
        await logAdminAction('admin_cleanup_all_codes', 'valid_key', { deleted: keys.length }, true);
        break;
      }

      case 'delete_user_data': {
        if (!target) {
          const error = createErrorResponse('Target address required for user data deletion', 400, 'MISSING_TARGET');
          return NextResponse.json(error.body, { status: error.status });
        }
        
        const userKey = `pixotchi:user-invites:${target.toLowerCase()}`;
        const validatedKey = `pixotchi:user-validated:${target.toLowerCase()}`;
        
        let deleted = 0;
        if (await redis.exists(userKey)) {
          await redis.del(userKey);
          deleted++;
        }
        if (await redis.exists(validatedKey)) {
          await redis.del(validatedKey);
          deleted++;
        }
        
        result = { success: true, message: `Deleted user data for ${target}`, deleted };
        await logAdminAction('admin_cleanup_user', 'valid_key', { target, deleted }, true);
        break;
      }

      case 'reset_daily_limits': {
        const keys = await redis.keys('pixotchi:user-invites:*');
        let updated = 0;
        
        for (const key of keys) {
          try {
            const data = await redis.get(key);
            if (data) {
              const userData = JSON.parse(data as string);
              userData.dailyGenerated = 0;
              userData.lastGeneratedDate = '';
              await redis.set(key, JSON.stringify(userData));
              updated++;
            }
          } catch (error) {
            console.error('Error processing user key:', key, error);
          }
        }
        
        result = { success: true, message: `Reset daily limits for ${updated} users`, deleted: updated };
        await logAdminAction('admin_reset_limits', 'valid_key', { updated }, true);
        break;
      }

      case 'delete_everything': {
        // This will delete ALL keys from the database - extremely dangerous!
        const allKeys = await redis.keys('*');
        let deleted = 0;
        
        // Delete in batches to avoid memory issues
        const batchSize = 100;
        for (let i = 0; i < allKeys.length; i += batchSize) {
          const batch = allKeys.slice(i, i + batchSize);
          try {
            if (batch.length > 0) {
              await redis.del(...batch);
              deleted += batch.length;
            }
          } catch (error) {
            console.error('Error deleting batch:', batch, error);
          }
        }
        
        result = { success: true, message: `DELETED EVERYTHING! Removed ${deleted} keys from database`, deleted };
        await logAdminAction('admin_delete_everything', 'valid_key', { deletedKeys: deleted, totalKeys: allKeys.length }, true);
        break;
      }

      default:
        await logAdminAction('admin_cleanup_failed', 'valid_key', { reason: 'invalid_action', action }, false);
        const error = createErrorResponse('Invalid cleanup action', 400, 'INVALID_ACTION');
        return NextResponse.json(error.body, { status: error.status });
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('Error in admin cleanup:', error);
    await logAdminAction('admin_cleanup_failed', 'unknown', { reason: 'internal_error' }, false);
    const errorResponse = createErrorResponse('Internal server error', 500);
    return NextResponse.json(errorResponse.body, { status: errorResponse.status });
  }
} 