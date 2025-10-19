import { redis, redisGetJSON } from '@/lib/redis';
import { logger } from '@/lib/logger';

export async function GET(request: Request) {
  try {
    if (!redis) {
      return Response.json(
        { error: 'Database unavailable' },
        { status: 503 }
      );
    }

    // Get all feedback IDs sorted by timestamp (newest first)
    const feedbackIds = (await redis.zrange('pixotchi:feedback:list', 0, -1)) as string[];

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
