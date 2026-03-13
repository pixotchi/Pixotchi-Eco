import { NextRequest, NextResponse } from 'next/server';
import { getRecentMessages } from '@/lib/chat-service';
import { redisExpire, redisIncrBy } from '@/lib/redis';

const CHAT_READ_LIMIT_PER_MINUTE = 120;
const CHAT_READ_WINDOW_SECONDS = 60;

function getRequestIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim() ||
    'unknown'
  );
}

export async function GET(request: NextRequest) {
  try {
    const ip = getRequestIp(request);
    if (ip !== 'unknown') {
      const currentWindow = Math.floor(Date.now() / 1000 / CHAT_READ_WINDOW_SECONDS);
      const rateLimitKey = `chat:read:ratelimit:${ip}:${currentWindow}`;
      const hits = await redisIncrBy(rateLimitKey, 1);

      if (hits === 1) {
        await redisExpire(rateLimitKey, CHAT_READ_WINDOW_SECONDS + 5);
      }

      if (hits !== null && hits > CHAT_READ_LIMIT_PER_MINUTE) {
        return NextResponse.json(
          { error: 'Too many requests' },
          {
            status: 429,
            headers: {
              'Retry-After': String(CHAT_READ_WINDOW_SECONDS),
              'Cache-Control': 'private, no-store',
            },
          },
        );
      }
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    
    // Validate limit
    if (limit > 100) {
      return NextResponse.json(
        { error: 'Limit cannot exceed 100' },
        { status: 400 }
      );
    }

    const messages = await getRecentMessages(limit);

    return NextResponse.json(
      {
        messages,
        count: messages.length,
        timestamp: Date.now()
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=2, stale-while-revalidate=8',
        },
      },
    );
  } catch (error) {
    console.error('Error fetching chat messages:', error);
    return NextResponse.json(
      { error: 'Failed to fetch messages' },
      { status: 500 }
    );
  }
}
