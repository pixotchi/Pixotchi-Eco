import { redis, redisSetJSON } from '@/lib/redis';
import { logger } from '@/lib/logger';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { address, message } = body;

    // Validation
    if (!address || typeof address !== 'string') {
      return Response.json(
        { error: 'Invalid address' },
        { status: 400 }
      );
    }

    if (!message || typeof message !== 'string') {
      return Response.json(
        { error: 'Invalid message' },
        { status: 400 }
      );
    }

    const trimmedMessage = message.trim();
    if (trimmedMessage.length < 10 || trimmedMessage.length > 1000) {
      return Response.json(
        { error: 'Message must be between 10 and 1000 characters' },
        { status: 400 }
      );
    }

    if (!redis) {
      return Response.json(
        { error: 'Database unavailable' },
        { status: 503 }
      );
    }

    // Store feedback in Redis
    const feedbackId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const feedbackKey = `pixotchi:feedback:${feedbackId}`;
    
    const feedbackData = {
      id: feedbackId,
      address: address.toLowerCase(),
      message: trimmedMessage,
      createdAt: Date.now(),
      status: 'new',
    };

    await redisSetJSON(feedbackKey, feedbackData, {
      ex: 86400 * 90, // Expire after 90 days
    });

    // Add to feedback list for admin
    await redis.zadd(
      'pixotchi:feedback:list',
      Date.now(),
      feedbackId
    );

    logger.info(`Feedback submitted`, {
      feedbackId,
      address: address.toLowerCase(),
      messageLength: trimmedMessage.length,
    });

    return Response.json({
      success: true,
      message: 'Feedback submitted successfully',
    });
  } catch (error) {
    logger.error('Feedback submission error:', error);
    return Response.json(
      { error: 'Failed to submit feedback' },
      { status: 500 }
    );
  }
}
