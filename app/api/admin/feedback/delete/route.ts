import { redis, redisDel } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env-config';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    const adminKey = authHeader?.replace('Bearer ', '');

    if (!adminKey || adminKey !== env.ADMIN_KEY) {
      return Response.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    if (!redis) {
      return Response.json(
        { error: 'Database unavailable' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { feedbackId, deleteAll } = body;

    if (deleteAll) {
      // Delete all feedback
      const feedbackIds = await redis.zrevrange('pixotchi:feedback:list', 0, -1);
      
      if (feedbackIds && feedbackIds.length > 0) {
        for (const id of feedbackIds) {
          await redisDel(`pixotchi:feedback:${id}`);
        }
        await redisDel('pixotchi:feedback:list');
      }

      logger.info('All feedback deleted by admin');
      return Response.json({
        success: true,
        message: `Deleted ${feedbackIds?.length || 0} feedback messages`,
        deletedCount: feedbackIds?.length || 0,
      });
    } else if (feedbackId) {
      // Delete single feedback
      await redisDel(`pixotchi:feedback:${feedbackId}`);
      await redis.zrem('pixotchi:feedback:list', feedbackId);

      logger.info(`Feedback deleted: ${feedbackId}`);
      return Response.json({
        success: true,
        message: 'Feedback deleted',
      });
    } else {
      return Response.json(
        { error: 'Must provide feedbackId or deleteAll flag' },
        { status: 400 }
      );
    }
  } catch (error) {
    logger.error('Feedback deletion error:', error);
    return Response.json(
      { error: 'Failed to delete feedback' },
      { status: 500 }
    );
  }
}
