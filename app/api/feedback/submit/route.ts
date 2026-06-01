import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';
import { redis, redisSetJSON } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { nanoid } from 'nanoid';
import { isAddress } from 'viem';

const FEEDBACK_IP_LIMIT = 5;
const FEEDBACK_WINDOW_SECONDS = 900;
const FARCASTER_DETAILS_MAX_BYTES = 2048;

function cleanOptionalString(value: UntypedValue, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function sanitizeFarcasterDetails(value: UntypedValue): Record<string, UntypedValue> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const serialized = JSON.stringify(value);
  if (serialized.length > FARCASTER_DETAILS_MAX_BYTES) return null;
  const input = value as Record<string, UntypedValue>;
  return {
    ...(Number.isSafeInteger(Number(input.fid)) ? { fid: Number(input.fid) } : {}),
    ...(cleanOptionalString(input.username, 64) ? { username: cleanOptionalString(input.username, 64) } : {}),
    ...(cleanOptionalString(input.displayName, 80) ? { displayName: cleanOptionalString(input.displayName, 80) } : {}),
    ...(cleanOptionalString(input.pfpUrl, 256) ? { pfpUrl: cleanOptionalString(input.pfpUrl, 256) } : {}),
  };
}

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
    if (!address || typeof address !== 'string' || !isAddress(address)) {
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
    const normalizedAddress = address.toLowerCase();
    const feedbackId = `${Date.now()}-${nanoid(10)}`;
    const feedbackKey = `pixotchi:feedback:${feedbackId}`;
    const sanitizedFarcasterDetails = sanitizeFarcasterDetails(farcasterDetails);
    
    const feedbackData = {
      id: feedbackId,
      address: normalizedAddress,
      message: trimmedMessage,
      createdAt: Date.now(),
      status: 'new',
      walletType: cleanOptionalString(walletType, 32) || 'unknown',
      isSmartWallet: Boolean(isSmartWallet),
      isMiniApp: Boolean(isMiniApp),
      farcasterDetails: sanitizedFarcasterDetails,
    };

    await redisSetJSON(feedbackKey, feedbackData, 86400 * 90);

    // Add to feedback list for admin
    await redis.zadd('pixotchi:feedback:list', {
      score: Date.now(),
      member: feedbackId,
    });

    logger.info(`Feedback submitted`, {
      feedbackId,
      address: normalizedAddress,
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
