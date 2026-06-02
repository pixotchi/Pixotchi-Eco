import { NextRequest, NextResponse } from 'next/server';
import { redis, redisExpire, redisIncrBy, withPrefix } from './redis';
import { createHash, timingSafeEqual } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

export type AdminAuditContext = {
  ip: string;
  method: string;
  route: string;
  userAgent: string;
};

type AdminRateLimitResult =
  | { allowed: true }
  | { allowed: false; code: string; message: string; retryAfter?: string; status: number };

const adminAuditContextStorage = new AsyncLocalStorage<AdminAuditContext>();

function getRequestIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim() ||
    'unknown'
  );
}

function getAdminAuditContext(request: NextRequest): AdminAuditContext {
  return {
    ip: getRequestIp(request),
    method: request.method,
    route: request.nextUrl?.pathname || 'unknown',
    userAgent: request.headers.get('user-agent')?.slice(0, 240) || 'unknown',
  };
}

function fingerprintAdminKey(adminKey: string): string {
  return createHash('sha256').update(adminKey || 'unknown').digest('hex').slice(0, 16);
}

// Admin authentication utility
export function validateAdminKey(request: NextRequest): boolean {
  const adminKey = process.env.ADMIN_INVITE_KEY;
  
  if (!adminKey) {
    console.error('ADMIN_INVITE_KEY environment variable not set');
    return false;
  }
  
  // Get admin key from Authorization header
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  
  const providedKey = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  // Use constant-time comparison to prevent timing attacks
  try {
    // Ensure both strings are the same length to use timingSafeEqual
    if (providedKey.length !== adminKey.length) {
      return false;
    }
    
    const providedBuffer = Buffer.from(providedKey, 'utf-8');
    const adminBuffer = Buffer.from(adminKey, 'utf-8');
    
    return timingSafeEqual(providedBuffer, adminBuffer);
  } catch (error) {
    console.error('Admin key comparison failed:', error);
    return false;
  }
}

// Rate limiting for admin authentication attempts
export async function checkAdminRateLimit(ip: string): Promise<AdminRateLimitResult> {
  if (!redis) {
    if (process.env.NODE_ENV === 'production') {
      console.error('Redis unavailable - blocking admin request in production');
      return {
        allowed: false,
        code: 'ADMIN_RATE_LIMIT_UNAVAILABLE',
        message: 'Admin rate limit service unavailable',
        status: 503,
      };
    }

    console.warn('Redis unavailable - allowing admin request in non-production only');
    return { allowed: true };
  }

  try {
    const rateLimitKey = `admin:ratelimit:${ip}`;
    const attempts = await redis.get(withPrefix(rateLimitKey));
    const attemptsCount = attempts ? parseInt(String(attempts), 10) : 0;
    
    // Allow 10 attempts per 15 minutes
    if (attemptsCount >= 10) {
      console.warn(`Admin rate limit exceeded for IP: ${ip}`);
      return {
        allowed: false,
        code: 'ADMIN_RATE_LIMITED',
        message: 'Too many admin authentication attempts',
        retryAfter: '900',
        status: 429,
      };
    }
    
    return { allowed: true };
  } catch (error) {
    console.error('Rate limit check failed:', error);
    if (process.env.NODE_ENV === 'production') {
      return {
        allowed: false,
        code: 'ADMIN_RATE_LIMIT_UNAVAILABLE',
        message: 'Admin rate limit service unavailable',
        status: 503,
      };
    }

    return { allowed: true };
  }
}

// Track failed admin authentication attempt
export async function trackAdminFailedAttempt(ip: string): Promise<void> {
  if (!redis) return;
  
  try {
    const rateLimitKey = `admin:ratelimit:${ip}`;
    const count = await redisIncrBy(rateLimitKey, 1);
    if (count === 1) {
      await redisExpire(rateLimitKey, 900);
    }
  } catch (error) {
    console.error('Failed to track admin attempt:', error);
  }
}

export async function requireAdmin(request: NextRequest): Promise<NextResponse | null> {
  adminAuditContextStorage.enterWith(getAdminAuditContext(request));
  const ip = getRequestIp(request);
  const rateLimit = await checkAdminRateLimit(ip);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      createErrorResponse(rateLimit.message, rateLimit.status, rateLimit.code).body,
      {
        status: rateLimit.status,
        headers: {
          ...(rateLimit.retryAfter ? { 'Retry-After': rateLimit.retryAfter } : {}),
          'Cache-Control': 'private, no-store',
        },
      },
    );
  }

  if (!validateAdminKey(request)) {
    await trackAdminFailedAttempt(ip);
    return NextResponse.json(
      createErrorResponse('Unauthorized', 401, 'ADMIN_AUTH_REQUIRED').body,
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  return null;
}

// Audit logging for admin actions
export async function logAdminAction(
  action: string,
  adminKey: string,
  details: Record<string, UntypedValue> = {},
  success: boolean = true,
  context?: AdminAuditContext,
): Promise<void> {
  try {
    if (!redis) {
      console.error('Redis not available for audit logging');
      return;
    }

    const auditContext = context || adminAuditContextStorage.getStore();
    const logEntry = {
      action,
      adminKeyFingerprint: fingerprintAdminKey(adminKey),
      details,
      ip: auditContext?.ip || 'unknown',
      method: auditContext?.method || 'unknown',
      route: auditContext?.route || 'unknown',
      success,
      timestamp: new Date().toISOString(),
      userAgent: auditContext?.userAgent || 'unknown',
    };

    // Store audit log with expiration (keep for 30 days)
    const logKey = `audit:${Date.now()}:${action}`;
    await redis.setex(logKey, 30 * 24 * 60 * 60, JSON.stringify(logEntry));
    
    // Also maintain a list of recent audit logs
    await redis.lpush('audit:recent', logKey);
    await redis.ltrim('audit:recent', 0, 1000); // Keep last 1000 entries
    
    console.log(`Audit log: ${action} - ${success ? 'SUCCESS' : 'FAILED'}`, details);
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

// Standardized error response creator
export function createErrorResponse(
  message: string, 
  status: number, 
  code?: string
): { body: UntypedValue; status: number } {
  return {
    body: {
      success: false,
      error: message,
      code,
      timestamp: new Date().toISOString(),
    },
    status,
  };
} 
