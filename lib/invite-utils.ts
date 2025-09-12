import { nanoid, customAlphabet } from 'nanoid';

// Create custom alphabet excluding confusing characters (0, O, I, l, 1)
const createInviteCode = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 8);

export const INVITE_CONFIG = {
  CODE_LENGTH: 8,
  DAILY_LIMIT: parseInt(process.env.INVITE_DAILY_LIMIT || '2'),
  EXPIRY_HOURS: parseInt(process.env.INVITE_CODE_EXPIRY_HOURS || '168'), // 7 days
  SYSTEM_ENABLED: process.env.NEXT_PUBLIC_INVITE_SYSTEM_ENABLED === 'true',
  ADMIN_GENERATION_ENABLED: process.env.ADMIN_INVITE_GENERATION_ENABLED === 'true',
};

/**
 * Generate a secure invite code
 */
export function generateSecureCode(): string {
  return createInviteCode();
}

/**
 * Validate invite code format
 */
export function isValidCodeFormat(code: string): boolean {
  if (!code || typeof code !== 'string') return false;
  
  // Check length and valid characters
  const validPattern = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;
  return validPattern.test(code.toUpperCase());
}

/**
 * Format invite URL for sharing
 */
export function formatInviteUrl(code: string, baseUrl?: string): string {
  const url = baseUrl || process.env.NEXT_PUBLIC_URL || '';
  return `${url}?invite=${code}`;
}

/**
 * Get today's date string for daily limit tracking
 */
export function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Check if a timestamp is expired
 */
export function isExpired(timestamp: number): boolean {
  return Date.now() > timestamp;
}

/**
 * Calculate expiration timestamp
 */
export function calculateExpiration(): number {
  return Date.now() + (INVITE_CONFIG.EXPIRY_HOURS * 60 * 60 * 1000);
}

/**
 * Validate user eligibility for invite actions
 */
export function validateUserEligibility(address: string): { valid: boolean; error?: string } {
  if (!address || typeof address !== 'string' || !address.startsWith('0x')) {
    return { valid: false, error: 'Invalid wallet address' };
  }
  
  if (!INVITE_CONFIG.SYSTEM_ENABLED) {
    return { valid: false, error: 'Invite system is disabled' };
  }
  
  return { valid: true };
}

/**
 * Generate Redis keys for invite system
 */
export const RedisKeys = {
  inviteCode: (code: string) => `pixotchi:invite-codes:${code.toUpperCase()}`,
  userInvites: (address: string) => `pixotchi:user-invites:${address.toLowerCase()}`,
  dailyLimit: (address: string, date: string) => `pixotchi:daily-limits:${address.toLowerCase()}:${date}`,
  inviteUsage: (code: string) => `pixotchi:invite-usage:${code.toUpperCase()}`,
  // Store which users have been validated (to bypass invite gate)
  userValidated: (address: string) => `pixotchi:user-validated:${address.toLowerCase()}`,
};

/**
 * Clean and normalize invite code
 */
export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().trim();
}

/**
 * Get user's local storage key for invite validation
 */
export function getLocalStorageKeys() {
  return {
    INVITE_VALIDATED: 'pixotchi:invite-validated',
    VALIDATED_CODE: 'pixotchi:validated-code',
    USER_ADDRESS: 'pixotchi:user-address',
  };
}

/**
 * Generate a summary message for invite stats
 */
export function formatInviteStatsMessage(stats: {
  totalInvites: number;
  successfulInvites: number;
  dailyRemaining: number;
}): string {
  const { totalInvites, successfulInvites, dailyRemaining } = stats;
  
  if (totalInvites === 0) {
    return `You haven't generated any invite codes yet. You can create ${dailyRemaining} today.`;
  }
  
  const successRate = totalInvites > 0 ? Math.round((successfulInvites / totalInvites) * 100) : 0;
  
  return `You've invited ${successfulInvites} users (${successRate}% success rate). ${dailyRemaining} codes remaining today.`;
} 