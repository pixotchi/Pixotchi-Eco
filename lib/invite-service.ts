import { redis } from './redis';
import { 
  InviteCode, 
  UserInviteData, 
  InviteStats, 
  InviteValidationResult, 
  InviteGenerationResult 
} from './types';
import { 
  generateSecureCode, 
  isValidCodeFormat, 
  getTodayDateString, 
  isExpired, 
  calculateExpiration, 
  validateUserEligibility, 
  RedisKeys, 
  normalizeInviteCode,
  INVITE_CONFIG 
} from './invite-utils';

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

    const normalizedAddress = address.toLowerCase();

    // Check user eligibility
    const eligibilityCheck = validateUserEligibility(normalizedAddress);
    if (!eligibilityCheck.valid) {
      return {
        success: false,
        error: eligibilityCheck.error || 'User not eligible',
        errorCode: 'USER_INELIGIBLE'
      };
    }

    // Check daily limit
    const canGenerate = await checkDailyLimit(normalizedAddress);
    if (!canGenerate) {
      return {
        success: false,
        error: 'Daily generation limit reached',
        errorCode: 'DAILY_LIMIT_EXCEEDED'
      };
    }

    // Generate unique code
    const code = generateSecureCode();
    const now = Date.now();
    const expiresAt = now + (INVITE_CONFIG.EXPIRY_HOURS * 60 * 60 * 1000);

    const inviteCode: InviteCode = {
      code,
      createdBy: normalizedAddress,
      createdAt: now,
      isUsed: false,
      expiresAt,
    };

    // Store the code
    const codeKey = RedisKeys.inviteCode(code);
    await redis.set(codeKey, JSON.stringify(inviteCode));

    // Update user data
    let userData = await getUserInviteData(normalizedAddress);
    if (!userData) {
      userData = createDefaultUserData(normalizedAddress);
    }

    const today = getTodayDateString();
    
    // Update generation counts
    userData.totalCodesGenerated++;
    if (userData.lastGeneratedDate === today) {
      userData.dailyGenerated++;
    } else {
      userData.dailyGenerated = 1;
      userData.lastGeneratedDate = today;
    }

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
    if (userAddress && inviteCode.createdBy.toLowerCase() === userAddress.toLowerCase()) {
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

/**
 * Mark an invite code as used
 */
export async function markCodeAsUsed(code: string, userAddress?: string): Promise<{ success: boolean; error?: string; errorCode?: string }> {
  try {
    if (!redis) {
      return { 
        success: false, 
        error: 'Database not available',
        errorCode: 'REDIS_UNAVAILABLE'
      };
    }

    const normalizedCode = code.toUpperCase();
    const inviteCode = await getInviteCode(normalizedCode);

    if (!inviteCode) {
      return {
        success: false,
        error: 'Invite code not found',
        errorCode: 'NOT_FOUND'
      };
    }

    if (inviteCode.isUsed) {
      return {
        success: false,
        error: 'Invite code already used',
        errorCode: 'ALREADY_USED'
      };
    }

    // Update the code
    inviteCode.isUsed = true;
    inviteCode.usedAt = Date.now();
    if (userAddress) {
      inviteCode.usedBy = userAddress.toLowerCase();
    }

    // Store updated code
    const codeKey = RedisKeys.inviteCode(normalizedCode);
    await redis.set(codeKey, JSON.stringify(inviteCode));

    // Update creator's stats
    if (inviteCode.createdBy) {
      let creatorData = await getUserInviteData(inviteCode.createdBy);
      if (!creatorData) {
        creatorData = createDefaultUserData(inviteCode.createdBy);
      }

      creatorData.totalCodesUsed++;
      if (userAddress && !creatorData.invitedUsers.includes(userAddress.toLowerCase())) {
        creatorData.invitedUsers.push(userAddress.toLowerCase());
      }

      await updateUserInviteData(inviteCode.createdBy, creatorData);
    }

    // Update user's data if they used the code
    if (userAddress) {
      let userData = await getUserInviteData(userAddress);
      if (!userData) {
        userData = createDefaultUserData(userAddress);
      }

      userData.invitedBy = inviteCode.createdBy;
      userData.joinedAt = Date.now();

      await updateUserInviteData(userAddress, userData);
    }

    return { success: true };

  } catch (error) {
    console.error('Error marking code as used:', error);
    return {
      success: false,
      error: 'Failed to mark code as used',
      errorCode: 'UPDATE_FAILED'
    };
  }
}

/**
 * Get user's invite statistics
 */
export async function getUserInviteStats(address: string): Promise<InviteStats> {
  try {
    const normalizedAddress = address.toLowerCase();
    const userData = await getUserInviteData(normalizedAddress);
    const today = getTodayDateString();
    
    // Handle case where user data doesn't exist yet
    if (!userData) {
      return {
        totalInvites: 0,
        successfulInvites: 0,
        dailyRemaining: INVITE_CONFIG.DAILY_LIMIT,
        canGenerateToday: true,
      };
    }
    
    const dailyGenerated = userData.lastGeneratedDate === today ? userData.dailyGenerated : 0;
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
    
    // If user data doesn't exist yet, they can generate
    if (!userData) {
      return true;
    }
    
    // If last generation was not today, reset the counter
    if (userData.lastGeneratedDate !== today) {
      return true;
    }
    
    const canGenerate = userData.dailyGenerated < INVITE_CONFIG.DAILY_LIMIT;
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
  const normalizedAddress = address.toLowerCase();
  
  console.log('🔍 [API DEBUG] isUserValidated called');
  console.log('🔍 [API DEBUG] Original address:', address);
  console.log('🔍 [API DEBUG] Normalized address:', normalizedAddress);
  console.log('🔍 [API DEBUG] INVITE_CONFIG.SYSTEM_ENABLED:', INVITE_CONFIG.SYSTEM_ENABLED);
  
  // If invite system is disabled, everyone is validated
  if (!INVITE_CONFIG.SYSTEM_ENABLED) {
    console.log('🔍 [API DEBUG] System disabled - returning true');
    return true;
  }
  
  if (!redis) {
    console.error('🔍 [API DEBUG] Redis not available for validation check');
    throw new Error('Database temporarily unavailable');
  }
  
  console.log('🔍 [API DEBUG] Redis available - checking validation');
  
  try {
    const redisKey = RedisKeys.userValidated(normalizedAddress);
    console.log('🔍 [API DEBUG] Redis key:', redisKey);
    
    const startTime = Date.now();
    const validated = await redis.get(redisKey);
    const queryTime = Date.now() - startTime;
    
    console.log('🔍 [API DEBUG] Redis query completed in', queryTime, 'ms');
    console.log('🔍 [API DEBUG] Raw Redis response:', validated);
    console.log('🔍 [API DEBUG] Response type:', typeof validated);
    
    // Handle both boolean true and string 'true' responses
    const isValidated = validated === true || validated === 'true';
    console.log('🔍 [API DEBUG] Final validation result:', isValidated);
    
    return isValidated;
  } catch (error) {
    console.error('🔍 [API DEBUG] Error checking user validation:', error);
    console.error('🔍 [API DEBUG] Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'No stack trace',
      name: error instanceof Error ? error.name : 'Unknown error type'
    });
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

    const normalizedAddress = address.toLowerCase();
    const redisKey = RedisKeys.userValidated(normalizedAddress);
    
    // Set user as validated (no expiration)
    await redis.set(redisKey, 'true');
    
    console.log(`User ${normalizedAddress} marked as validated`);
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

// Helper functions

async function codeExists(code: string): Promise<boolean> {
  if (!redis) return false;
  
  try {
    const exists = await redis.exists(RedisKeys.inviteCode(code));
    return exists === 1;
  } catch (error) {
    console.error('Error checking code existence:', error);
    return false;
  }
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
    let parsed: any;
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
    let parsed: any;
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
    
    console.log(`✅ Updated user data for ${normalizedAddress}:`, {
      dailyGenerated: data.dailyGenerated,
      totalCodesGenerated: data.totalCodesGenerated,
      lastGeneratedDate: data.lastGeneratedDate
    });
    
    return true;
  } catch (error) {
    console.error('Error updating user invite data:', error);
    return false;
  }
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