import { NextRequest, NextResponse } from 'next/server';
import { redisIncrementWithExpiry } from './redis';

interface RateLimitRule {
  kind: 'ip' | 'address' | 'global';
  identifier?: string | null;
  limit: number;
  windowSeconds: number;
}

interface EnforceRateLimitOptions {
  /** Paid/signing endpoints should reject requests when durable accounting is unavailable. */
  failClosed?: boolean;
  /** Charge by actual bounded work, rather than just the HTTP request count. */
  cost?: number;
  scope: string;
  rules: RateLimitRule[];
}

function normalizeIdentifier(kind: RateLimitRule['kind'], identifier?: string | null): string | null {
  if (!identifier) return null;

  const trimmed = identifier.trim();
  if (!trimmed) return null;

  return kind === 'address' ? trimmed.toLowerCase() : trimmed;
}

export function getRequestIp(request: NextRequest): string | null {
  const ip = (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim() ||
    ''
  );

  return ip || null;
}

export async function enforceRateLimit(
  _request: NextRequest,
  options: EnforceRateLimitOptions,
): Promise<NextResponse | null> {
  let retryAfterSeconds = 0;
  const cost = options.cost ?? 1;
  if (!Number.isSafeInteger(cost) || cost < 1) throw new Error('Invalid rate limit cost');

  for (const rule of options.rules) {
    const normalizedIdentifier = rule.kind === 'global' ? 'all' : normalizeIdentifier(rule.kind, rule.identifier);
    if (!normalizedIdentifier) continue;

    const currentWindow = Math.floor(Date.now() / 1000 / rule.windowSeconds);
    const rateLimitKey = `ratelimit:${options.scope}:${rule.kind}:${normalizedIdentifier}:${currentWindow}`;
    const hits = await redisIncrementWithExpiry(rateLimitKey, cost, rule.windowSeconds + 5);

    if (hits === null && options.failClosed) {
      return NextResponse.json(
        { error: 'Request protection is temporarily unavailable. Please try again shortly.' },
        {
          status: 503,
          headers: {
            'Cache-Control': 'private, no-store',
            'Retry-After': '30',
          },
        },
      );
    }

    if (hits !== null && hits > rule.limit) {
      retryAfterSeconds = Math.max(retryAfterSeconds, rule.windowSeconds);
    }
  }

  if (retryAfterSeconds === 0) {
    return null;
  }

  return NextResponse.json(
    { error: 'Rate limit exceeded. Please slow down and try again shortly.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds),
        'Cache-Control': 'private, no-store',
      },
    },
  );
}
