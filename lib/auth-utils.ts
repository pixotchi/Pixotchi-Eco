import { NextRequest } from 'next/server';
import { redis } from './redis';
import { timingSafeEqual } from 'crypto';

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
export async function checkAdminRateLimit(ip: string): Promise<boolean> {
  if (!redis) {
    console.warn('Redis unavailable - allowing admin request (rate limit bypass)');
    return true; // Allow if Redis is down (could be changed to fail closed for higher security)
  }

  try {
    const rateLimitKey = `admin:ratelimit:${ip}`;
    const attempts = await redis.get(rateLimitKey);
    const attemptsCount = attempts ? parseInt(String(attempts), 10) : 0;
    
    // Allow 10 attempts per 15 minutes
    if (attemptsCount >= 10) {
      console.warn(`Admin rate limit exceeded for IP: ${ip}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Rate limit check failed:', error);
    return true; // Allow on error to prevent lockout
  }
}

// Track failed admin authentication attempt
export async function trackAdminFailedAttempt(ip: string): Promise<void> {
  if (!redis) return;
  
  try {
    const rateLimitKey = `admin:ratelimit:${ip}`;
    const current = await redis.get(rateLimitKey);
    const count = current ? parseInt(String(current), 10) : 0;
    
    // Increment and set 15 minute expiration
    await redis.set(rateLimitKey, String(count + 1), { ex: 900 });
  } catch (error) {
    console.error('Failed to track admin attempt:', error);
  }
}

// Audit logging for admin actions
export async function logAdminAction(
  action: string,
  adminKey: string,
  details: Record<string, any> = {},
  success: boolean = true
): Promise<void> {
  try {
    if (!redis) {
      console.error('Redis not available for audit logging');
      return;
    }

    const logEntry = {
      action,
      adminKey: adminKey.substring(0, 8) + '***', // Partially mask the key
      details,
      success,
      timestamp: new Date().toISOString(),
      ip: 'unknown', // Could be enhanced later if needed
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
): { body: any; status: number } {
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