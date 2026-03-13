import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';
import { redis, redisSetJSON } from '@/lib/redis';
import { logger } from '@/lib/logger';

const FEEDBACK_IP_LIMIT = 5;
const FEEDBACK_WINDOW_SECONDS = 900;

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, {
      scope: 'api:feedback:submit',
      rules: [
        {
          kind: 'ip',
          identifier: getRequestIp(request),
          limit: FEEDBACK_IP_LIMIT,
          windowSeconds: FEEDBACK_WINDOW_SECONDS,
        },
      ],
    });

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const body = await request.json();
    const { 
      address, 
      message,
      walletType,
      isSmartWallet,
      isMiniApp,
      farcasterDetails,
    } = body;

    // Validation
    if (!address || typeof address !== 'string') {
      return NextResponse.json(
        { error: 'Invalid address' },
        { status: 400 }
      );
    }

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Invalid message' },
        { status: 400 }
      );
    }

    const trimmedMessage = message.trim();
    if (trimmedMessage.length < 10 || trimmedMessage.length > 1000) {
      return NextResponse.json(
        { error: 'Message must be between 10 and 1000 characters' },
        { status: 400 }
      );
    }

    if (!redis) {
      return NextResponse.json(
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
      walletType: walletType || 'unknown',
      isSmartWallet: Boolean(isSmartWallet),
      isMiniApp: Boolean(isMiniApp),
      farcasterDetails: farcasterDetails || null,
    };

    await redisSetJSON(feedbackKey, feedbackData, 86400 * 90);

    // Add to feedback list for admin
    await redis.zadd('pixotchi:feedback:list', {
      score: Date.now(),
      member: feedbackId,
    });

    logger.info(`Feedback submitted`, {
      feedbackId,
      address: address.toLowerCase(),
      messageLength: trimmedMessage.length,
      walletType,
      isSmartWallet,
      isMiniApp,
    });

    return NextResponse.json({
      success: true,
      message: 'Feedback submitted successfully',
    });
  } catch (error) {
    logger.error('Feedback submission error:', error);
    return NextResponse.json(
      { error: 'Failed to submit feedback' },
      { status: 500 }
    );
  }
}
