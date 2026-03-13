import { NextRequest, NextResponse } from 'next/server';
import { redisExpire, redisIncrBy } from './redis';

interface RateLimitRule {
  kind: 'ip' | 'address';
  identifier?: string | null;
  limit: number;
  windowSeconds: number;
}

interface EnforceRateLimitOptions {
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

  for (const rule of options.rules) {
    const normalizedIdentifier = normalizeIdentifier(rule.kind, rule.identifier);
    if (!normalizedIdentifier) continue;

    const currentWindow = Math.floor(Date.now() / 1000 / rule.windowSeconds);
    const rateLimitKey = `ratelimit:${options.scope}:${rule.kind}:${normalizedIdentifier}:${currentWindow}`;
    const hits = await redisIncrBy(rateLimitKey, 1);

    if (hits === 1) {
      await redisExpire(rateLimitKey, rule.windowSeconds + 5);
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
