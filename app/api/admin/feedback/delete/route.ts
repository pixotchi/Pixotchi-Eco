import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-utils';
import { redis, redisDel } from '@/lib/redis';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const adminDenied = await requireAdmin(request);
    if (adminDenied) return adminDenied;

    if (!redis) {
      return NextResponse.json(
        { error: 'Database unavailable' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { feedbackId, deleteAll } = body;

    if (deleteAll) {
      // Delete all feedback
      const feedbackIds = (await redis.zrange('pixotchi:feedback:list', 0, -1)) as string[];

      if (feedbackIds && feedbackIds.length > 0) {
        const keysToDelete = feedbackIds.map(id => `pixotchi:feedback:${id}`);
        await redis.del(...keysToDelete);
        await redis.del('pixotchi:feedback:list');
      }

      logger.info('All feedback deleted by admin');
      return NextResponse.json({
        success: true,
        message: `Deleted ${feedbackIds?.length || 0} feedback messages`,
        deletedCount: feedbackIds?.length || 0,
      });
    } else if (feedbackId) {
      // Delete single feedback
      await redisDel(`pixotchi:feedback:${feedbackId}`);
      await redis.zrem('pixotchi:feedback:list', feedbackId);

      logger.info(`Feedback deleted: ${feedbackId}`);
      return NextResponse.json({
        success: true,
        message: 'Feedback deleted',
      });
    } else {
      return NextResponse.json(
        { error: 'Must provide feedbackId or deleteAll flag' },
        { status: 400 }
      );
    }
  } catch (error) {
    logger.error('Feedback deletion error:', error);
    return NextResponse.json(
      { error: 'Failed to delete feedback' },
      { status: 500 }
    );
  }
}
