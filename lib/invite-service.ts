import {
INVITE_CONFIG,
RedisKeys,
generateSecureCode,
getTodayDateString,
isExpired,
isValidCodeFormat,
normalizeInviteCode,
validateUserEligibility
} from './invite-utils';
import { redis, redisCompareAndSetJSONRaw } from './redis';
import {
InviteCode,
InviteStats,
InviteValidationResult,
UserInviteData
} from './types';

type InviteActionResult = { success: boolean; error?: string; errorCode?: string };

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function secondsUntilNextUtcDay(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(24, 0, 0, 0);
  return Math.max(60, Math.ceil((tomorrow.getTime() - now.getTime()) / 1000));
}

async function getDailyGenerationCount(address: string, today = getTodayDateString()): Promise<number> {
  if (!redis) return 0;
  try {
    const raw = await redis.get(RedisKeys.dailyLimit(address, today));
    const count = Number(raw || 0);
    return Number.isFinite(count) && count > 0 ? count : 0;
  } catch (error) {
    console.error('Error reading invite daily counter:', error);
    return 0;
  }
}

async function incrementRaw(key: string, amount: number): Promise<number | null> {
  if (!redis) return null;
  try {
    const incrby = (redis as UntypedValue)?.incrby;
    if (typeof incrby === 'function') {
      return Number(await incrby.call(redis, key, amount));
    }

    const current = Number(await redis.get(key) || 0);
    const next = current + amount;
    await redis.set(key, String(next));
    return next;
  } catch (error) {
    console.error('Error incrementing invite counter:', error);
    return null;
  }
}

async function expireRaw(key: string, ttlSeconds: number): Promise<void> {
  if (!redis) return;
  try {
    await redis.expire(key, ttlSeconds);
  } catch (error) {
    console.error('Error expiring invite counter:', error);
  }
}

async function reserveDailyInviteSlot(address: string): Promise<{ success: boolean; count?: number; error?: string; errorCode?: string }> {
  const today = getTodayDateString();
  const key = RedisKeys.dailyLimit(address, today);
  const count = await incrementRaw(key, 1);

  if (count === null) {
    return { success: false, error: 'Database not available', errorCode: 'REDIS_UNAVAILABLE' };
  }

  if (count === 1) {
    await expireRaw(key, secondsUntilNextUtcDay() + 300);
  }

  if (count > INVITE_CONFIG.DAILY_LIMIT) {
    await incrementRaw(key, -1);
    return { success: false, error: 'Daily generation limit reached', errorCode: 'DAILY_LIMIT_EXCEEDED' };
  }

  return { success: true, count };
}

async function rollbackDailyInviteSlot(address: string): Promise<void> {
  try {
    await incrementRaw(RedisKeys.dailyLimit(address, getTodayDateString()), -1);
  } catch (error) {
    console.error('Failed to rollback invite daily counter:', error);
  }
}

/**
 * Generate a new invite code for a user
 */
export async function generateInviteCode(address: string): Promise<{ success: boolean; code?: string; error?: string; errorCode?: string }> {
  try {
    if (!redis) {
      return {
        success: false,
        error: 'Database not available',
        errorCode: 'REDIS_UNAVAILABLE'
      };
    }

    const normalizedAddress = normalizeAddress(address);

    // Check user eligibility
    const eligibilityCheck = validateUserEligibility(normalizedAddress);
    if (!eligibilityCheck.valid) {
      return {
        success: false,
        error: eligibilityCheck.error || 'User not eligible',
        errorCode: 'USER_INELIGIBLE'
      };
    }

    const validated = await isUserValidated(normalizedAddress);
    if (!validated) {
      return {
        success: false,
        error: 'Use a valid invite before generating invite codes.',
        errorCode: 'USER_NOT_VALIDATED'
      };
    }

    const reserved = await reserveDailyInviteSlot(normalizedAddress);
    if (!reserved.success) {
      return reserved;
    }

    // Generate unique code
    const now = Date.now();
    const expiresAt = now + (INVITE_CONFIG.EXPIRY_HOURS * 60 * 60 * 1000);
    let code = '';
    let stored = false;

    for (let attempt = 0; attempt < 5 && !stored; attempt++) {
      code = generateSecureCode();
      const inviteCode: InviteCode = {
        code,
        createdBy: normalizedAddress,
        createdAt: now,
        isUsed: false,
        expiresAt,
      };

      stored = await redisCompareAndSetJSONRaw(
        RedisKeys.inviteCode(code),
        null,
        JSON.stringify(inviteCode),
        INVITE_CONFIG.EXPIRY_HOURS * 60 * 60,
      );
    }

    if (!stored) {
      await rollbackDailyInviteSlot(normalizedAddress);
      return {
        success: false,
        error: 'Failed to generate unique invite code',
        errorCode: 'GENERATION_FAILED'
      };
    }

    // Update user data
    let userData = await getUserInviteData(normalizedAddress);
    if (!userData) {
      userData = createDefaultUserData(normalizedAddress);
    }

    const today = getTodayDateString();

    // Update generation counts
    userData.totalCodesGenerated++;
    userData.dailyGenerated = reserved.count || await getDailyGenerationCount(normalizedAddress, today);
    userData.lastGeneratedDate = today;

    const updateSuccess = await updateUserInviteData(normalizedAddress, userData);
    if (!updateSuccess) {
      console.error('Failed to update user data after code generation');
    }

    return {
      success: true,
      code,
    };

  } catch (error) {
    console.error('Error generating invite code:', error);
    return {
      success: false,
      error: 'Failed to generate invite code',
      errorCode: 'GENERATION_FAILED'
    };
  }
}

/**
 * Validate an invite code
 */
export async function validateInviteCode(code: string, userAddress?: string): Promise<InviteValidationResult> {
  try {
    // Basic format validation
    if (!isValidCodeFormat(code)) {
      return {
        valid: false,
        error: 'Invalid code format',
        errorCode: 'INVALID_FORMAT'
      };
    }

    const normalizedCode = normalizeInviteCode(code);

    // Get code from Redis
    const inviteCode = await getInviteCode(normalizedCode);
    if (!inviteCode) {
      return {
        valid: false,
        error: 'Invite code not found',
        errorCode: 'NOT_FOUND'
      };
    }

    // Check if already used
    if (inviteCode.isUsed) {
      return {
        valid: false,
        error: 'Invite code has already been used',
        errorCode: 'ALREADY_USED'
      };
    }

    // Check expiration
    if (inviteCode.expiresAt && isExpired(inviteCode.expiresAt)) {
      return {
        valid: false,
        error: 'Invite code has expired',
        errorCode: 'EXPIRED'
      };
    }

    // Check self-invitation (only if userAddress is provided)
    if (userAddress && inviteCode.createdBy.toLowerCase() === normalizeAddress(userAddress)) {
      return {
        valid: false,
        error: 'Cannot use your own invite code',
        errorCode: 'SELF_INVITE'
      };
    }

    return { valid: true, code: inviteCode };
  } catch (error) {
    console.error('Error validating invite code:', error);
    return {
      valid: false,
      error: 'Validation error'
    };
  }
}

export async function redeemInviteCode(code: string, userAddress: string): Promise<InviteActionResult & { alreadyUsedByUser?: boolean }> {
  try {
    if (!redis) {
      return {
        success: false,
        error: 'Database not available',
        errorCode: 'REDIS_UNAVAILABLE'
      };
    }

    const normalizedUserAddress = normalizeAddress(userAddress);
    const eligibilityCheck = validateUserEligibility(normalizedUserAddress);
    if (!eligibilityCheck.valid) {
      return {
        success: false,
        error: eligibilityCheck.error || 'User not eligible',
        errorCode: 'USER_INELIGIBLE'
      };
    }

    const validation = await validateInviteCode(code, normalizedUserAddress);
    if (!validation.valid || !validation.code) {
      return {
        success: false,
        error: validation.error || 'Invalid invite code',
        errorCode: validation.errorCode || 'INVALID_CODE'
      };
    }

    const normalizedCode = normalizeInviteCode(code);
    const codeKey = RedisKeys.inviteCode(normalizedCode);
    const raw = await redis.get(codeKey);
    if (!raw) {
      return { success: false, error: 'Invite code not found', errorCode: 'NOT_FOUND' };
    }

    const current = typeof raw === 'string' ? JSON.parse(raw) as InviteCode : raw as InviteCode;
    const expectedRaw = typeof raw === 'string' ? raw : JSON.stringify(current);

    if (current.isUsed) {
      if (current.usedBy?.toLowerCase() === normalizedUserAddress) {
        await markUserAsValidated(normalizedUserAddress);
        return { success: true, alreadyUsedByUser: true };
      }
      return { success: false, error: 'Invite code already used', errorCode: 'ALREADY_USED' };
    }

    if (current.createdBy.toLowerCase() === normalizedUserAddress) {
      return { success: false, error: 'Cannot use your own invite code', errorCode: 'SELF_INVITE' };
    }

    if (current.expiresAt && isExpired(current.expiresAt)) {
      return { success: false, error: 'Invite code has expired', errorCode: 'EXPIRED' };
    }

    const usedAt = Date.now();
    const nextCode: InviteCode = {
      ...current,
      isUsed: true,
      usedAt,
      usedBy: normalizedUserAddress,
    };

    const updated = await redisCompareAndSetJSONRaw(codeKey, expectedRaw, JSON.stringify(nextCode));
    if (!updated) {
      const latest = await getInviteCode(normalizedCode);
      if (latest?.isUsed && latest.usedBy?.toLowerCase() === normalizedUserAddress) {
        await markUserAsValidated(normalizedUserAddress);
        return { success: true, alreadyUsedByUser: true };
      }
      return { success: false, error: 'Invite code already used', errorCode: 'ALREADY_USED' };
    }

    await updateInviteUsageStats(nextCode, normalizedUserAddress, usedAt);
    await markUserAsValidated(normalizedUserAddress);

    return { success: true };
  } catch (error) {
    console.error('Error redeeming invite code:', error);
    return {
      success: false,
      error: 'Failed to use invite code',
      errorCode: 'UPDATE_FAILED'
    };
  }
}

/**
 * Mark an invite code as used
 */
export async function markCodeAsUsed(code: string, userAddress?: string): Promise<{ success: boolean; error?: string; errorCode?: string }> {
  if (!userAddress) {
    return {
      success: false,
      error: 'Authenticated wallet address is required',
      errorCode: 'USER_REQUIRED',
    };
  }

  return redeemInviteCode(code, userAddress);
}

/**
 * Get user's invite statistics
 */
export async function getUserInviteStats(address: string): Promise<InviteStats> {
  try {
    const normalizedAddress = address.toLowerCase();
    const userData = await getUserInviteData(normalizedAddress);
    const today = getTodayDateString();

    const counterGenerated = await getDailyGenerationCount(normalizedAddress, today);

    // Handle case where user data doesn't exist yet
    if (!userData) {
      const dailyRemaining = Math.max(0, INVITE_CONFIG.DAILY_LIMIT - counterGenerated);
      return {
        totalInvites: 0,
        successfulInvites: 0,
        dailyRemaining,
        canGenerateToday: dailyRemaining > 0,
      };
    }

    const dataGenerated = userData.lastGeneratedDate === today ? userData.dailyGenerated : 0;
    const dailyGenerated = Math.max(counterGenerated, dataGenerated);
    const dailyRemaining = Math.max(0, INVITE_CONFIG.DAILY_LIMIT - dailyGenerated);

    return {
      totalInvites: userData.totalCodesGenerated,
      successfulInvites: userData.totalCodesUsed,
      dailyRemaining,
      canGenerateToday: dailyRemaining > 0,
    };
  } catch (error) {
    console.error('Error getting user invite stats:', error);
    return {
      totalInvites: 0,
      successfulInvites: 0,
      dailyRemaining: INVITE_CONFIG.DAILY_LIMIT,
      canGenerateToday: true,
    };
  }
}

/**
 * Check if user can generate invite codes today
 */
export async function checkDailyLimit(address: string): Promise<boolean> {
  try {
    const normalizedAddress = address.toLowerCase();
    const userData = await getUserInviteData(normalizedAddress);
    const today = getTodayDateString();
    const counterGenerated = await getDailyGenerationCount(normalizedAddress, today);

    if (counterGenerated >= INVITE_CONFIG.DAILY_LIMIT) {
      return false;
    }

    // If user data doesn't exist yet, they can generate
    if (!userData) {
      return true;
    }

    // If last generation was not today, reset the counter
    if (userData.lastGeneratedDate !== today) {
      return true;
    }

    const canGenerate = Math.max(counterGenerated, userData.dailyGenerated) < INVITE_CONFIG.DAILY_LIMIT;
    return canGenerate;
  } catch (error) {
    console.error('Error checking daily limit:', error);
    return false;
  }
}

/**
 * Check if a user has been validated (can bypass invite gate)
 */
export async function isUserValidated(address: string): Promise<boolean> {
  const normalizedAddress = normalizeAddress(address);

  // If invite system is disabled, everyone is validated
  if (!INVITE_CONFIG.SYSTEM_ENABLED) {
    return true;
  }

  if (!redis) {
    console.error('Redis not available for validation check');
    throw new Error('Database temporarily unavailable');
  }

  try {
    const redisKey = RedisKeys.userValidated(normalizedAddress);
    const validated = await redis.get(redisKey);

    // Handle both boolean true and string 'true' responses
    return validated === true || validated === 'true';
  } catch (error) {
    console.error('Error checking user validation:', error);
    throw error;
  }
}

/**
 * Mark a user as validated (able to access the app)
 */
export async function markUserAsValidated(address: string): Promise<boolean> {
  try {
    if (!redis) {
      console.error('Redis not available in markUserAsValidated');
      throw new Error('Database temporarily unavailable');
    }

    const normalizedAddress = normalizeAddress(address);
    const redisKey = RedisKeys.userValidated(normalizedAddress);

    // Set user as validated (no expiration)
    await redis.set(redisKey, 'true');

    return true;

  } catch (error) {
    console.error('Error marking user as validated:', error);
    throw error;
  }
}

/**
 * Clean up expired invite codes
 */
export async function cleanupExpiredCodes(): Promise<number> {
  // Redis TTL will handle cleanup automatically
  // This function could be used for additional cleanup if needed
  return 0;
}

async function getInviteCode(code: string): Promise<InviteCode | null> {
  if (!redis) return null;

  try {
    const redisKey = RedisKeys.inviteCode(code);
    const data = await redis.get(redisKey);

    if (!data) {
      return null;
    }

    // Handle both string and object data from Redis
    let parsed: UntypedValue;
    if (typeof data === 'string') {
      parsed = JSON.parse(data);
    } else {
      parsed = data; // Already an object
    }

    return parsed;
  } catch (error) {
    console.error('Error getting invite code:', error);
    return null;
  }
}

async function getUserInviteData(address: string): Promise<UserInviteData | null> {
  try {
    if (!redis) {
      console.error('Redis not available in getUserInviteData');
      return null;
    }

    const normalizedAddress = address.toLowerCase();
    const userKey = RedisKeys.userInvites(normalizedAddress);
    const data = await redis.get(userKey);

    if (!data) {
      return null;
    }

    // Handle Redis returning either string or already-parsed object
    let parsed: UntypedValue;
    if (typeof data === 'string') {
      parsed = JSON.parse(data);
    } else {
      parsed = data; // Data is already an object
    }

    return parsed as UserInviteData;
  } catch (error) {
    console.error('Error getting user invite data:', error);
    return null;
  }
}

async function updateUserInviteData(address: string, data: UserInviteData): Promise<boolean> {
  try {
    if (!redis) {
      console.error('Redis not available in updateUserInviteData');
      return false;
    }

    const normalizedAddress = address.toLowerCase();
    const userKey = RedisKeys.userInvites(normalizedAddress);

    // Ensure address is normalized in the data
    data.address = normalizedAddress;

    // Store as JSON string
    await redis.set(userKey, JSON.stringify(data));

    return true;
  } catch (error) {
    console.error('Error updating user invite data:', error);
    return false;
  }
}

async function updateInviteUsageStats(inviteCode: InviteCode, userAddress: string, usedAt: number): Promise<void> {
  // Usage analytics are best-effort; code redemption itself is already committed atomically.
  if (inviteCode.createdBy) {
    let creatorData = await getUserInviteData(inviteCode.createdBy);
    if (!creatorData) {
      creatorData = createDefaultUserData(inviteCode.createdBy);
    }

    creatorData.totalCodesUsed++;
    if (!creatorData.invitedUsers.includes(userAddress)) {
      creatorData.invitedUsers.push(userAddress);
    }

    await updateUserInviteData(inviteCode.createdBy, creatorData);
  }

  let userData = await getUserInviteData(userAddress);
  if (!userData) {
    userData = createDefaultUserData(userAddress);
  }

  userData.invitedBy = inviteCode.createdBy;
  userData.joinedAt = usedAt;

  await updateUserInviteData(userAddress, userData);
}

function createDefaultUserData(address: string): UserInviteData {
  return {
    address: address.toLowerCase(),
    totalCodesGenerated: 0,
    totalCodesUsed: 0,
    dailyGenerated: 0,
    lastGeneratedDate: '',
    invitedUsers: [],
    joinedAt: Date.now(),
  };
}
