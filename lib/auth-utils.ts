import { NextRequest } from 'next/server';
import { redis } from './redis';

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
  return providedKey === adminKey;
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