import { redis, redisGetJSON, redisDel } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env-config';

export async function GET(request: Request) {
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

    // Get all feedback IDs sorted by timestamp (newest first)
    const feedbackIds = await redis.zrevrange('pixotchi:feedback:list', 0, -1);

    if (!feedbackIds || feedbackIds.length === 0) {
      return Response.json({
        success: true,
        feedback: [],
        total: 0,
      });
    }

    // Fetch all feedback data
    const feedbackList = [];
    for (const feedbackId of feedbackIds) {
      const feedback = await redisGetJSON(`pixotchi:feedback:${feedbackId}`);
      if (feedback) {
        feedbackList.push(feedback);
      }
    }

    return Response.json({
      success: true,
      feedback: feedbackList,
      total: feedbackList.length,
    });
  } catch (error) {
    logger.error('Feedback list error:', error);
    return Response.json(
      { error: 'Failed to fetch feedback' },
      { status: 500 }
    );
  }
}
