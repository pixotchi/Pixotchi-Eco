import { redis, redisGetJSON, redisSetJSON, withPrefix, redisDel } from './redis';
import { nanoid } from 'nanoid';

export type BroadcastMessage = {
  id: string;
  content: string;
  title?: string;
  createdAt: number;
  expiresAt?: number;
  priority: 'low' | 'normal' | 'high';
  type: 'info' | 'warning' | 'success' | 'announcement';
  createdBy: string;
  action?: {
    label: string;
    url: string;
  };
  dismissible: boolean; // Can users dismiss this?
  stats: {
    impressions: number; // How many times shown
    dismissals: number;  // How many times dismissed
  };
};

const KEYS = {
  message: (id: string) => `pixotchi:broadcast:message:${id}`,
  activeList: 'pixotchi:broadcast:active',
  dismissedByUser: (address: string) => `pixotchi:broadcast:dismissed:${address.toLowerCase()}`,
  impressions: (id: string) => `pixotchi:broadcast:impressions:${id}`,
};

/**
 * Create a new broadcast message
 */
export async function createBroadcast(data: {
  content: string;
  title?: string;
  expiresIn?: number;
  priority?: 'low' | 'normal' | 'high';
  type?: 'info' | 'warning' | 'success' | 'announcement';
  createdBy: string;
  action?: { label: string; url: string };
  dismissible?: boolean;
}): Promise<{ success: boolean; message?: BroadcastMessage; error?: string }> {
  try {
    if (!data.content || data.content.trim().length === 0) {
      return { success: false, error: 'Content is required' };
    }

    const id = nanoid(12);
    const now = Date.now();
    const expiresAt = data.expiresIn ? now + (data.expiresIn * 1000) : undefined;

    const message: BroadcastMessage = {
      id,
      content: data.content.trim(),
      title: data.title?.trim(),
      createdAt: now,
      expiresAt,
      priority: data.priority || 'normal',
      type: data.type || 'info',
      createdBy: data.createdBy,
      action: data.action,
      dismissible: data.dismissible !== false, // Default to true
      stats: {
        impressions: 0,
        dismissals: 0,
      },
    };

    // Store message
    await redisSetJSON(KEYS.message(id), message, data.expiresIn);

    // Add to active list (sorted by priority and timestamp)
    // Higher priority = lower score = shown first
    const priorityScore = message.priority === 'high' ? 1 : message.priority === 'normal' ? 2 : 3;
    const score = priorityScore * 1e12 + now;
    
    await redis?.zadd?.(
      withPrefix(KEYS.activeList),
      { score, member: id }
    );

    return { success: true, message };
  } catch (error) {
    console.error('Create broadcast error:', error);
    return { success: false, error: 'Failed to create broadcast' };
  }
}

/**
 * Get all active broadcast messages
 */
export async function getActiveBroadcasts(): Promise<BroadcastMessage[]> {
  try {
    // Get message IDs sorted by priority
    const activeIds = (await redis?.zrange?.(
      withPrefix(KEYS.activeList),
      0,
      -1
    ) || []) as string[];

    if (activeIds.length === 0) return [];

    // Fetch all messages
    const messages = await Promise.all(
      activeIds.map(id => redisGetJSON<BroadcastMessage>(KEYS.message(id)))
    );

    // Filter out expired and null messages
    const now = Date.now();
    const validMessages = messages.filter((msg): msg is BroadcastMessage => 
      msg !== null && (!msg.expiresAt || msg.expiresAt > now)
    );

    // Clean up expired messages
    const expiredIds = activeIds.filter((id, i) => {
      const msg = messages[i];
      return !msg || (msg.expiresAt && msg.expiresAt <= now);
    });
    if (expiredIds.length > 0) {
      await cleanupExpiredMessages(expiredIds);
    }

    return validMessages;
  } catch (error) {
    console.error('Get active broadcasts error:', error);
    return [];
  }
}

/**
 * Get messages for a specific user (respects dismissal)
 */
export async function getMessagesForUser(address?: string): Promise<BroadcastMessage[]> {
  try {
    const allMessages = await getActiveBroadcasts();
    
    if (!address) {
      // Anonymous user - show all messages
      return allMessages;
    }

    const normalizedAddress = address.toLowerCase();

    // Get dismissed message IDs for this user
    const dismissedIds = await redis?.smembers?.(
      withPrefix(KEYS.dismissedByUser(normalizedAddress))
    ) || [];
    const dismissedSet = new Set(dismissedIds);

    // Filter out dismissed messages
    return allMessages.filter(msg => !dismissedSet.has(msg.id));
  } catch (error) {
    console.error('Get messages for user error:', error);
    return [];
  }
}


/**
 * Dismiss a message for a user
 */
export async function dismissMessage(
  messageId: string, 
  address: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!address) {
      return { success: false, error: 'Address required' };
    }

    const normalizedAddress = address.toLowerCase();
    
    // Add to user's dismissed list
    await redis?.sadd?.(
      withPrefix(KEYS.dismissedByUser(normalizedAddress)),
      messageId
    );

    // Increment dismissal count
    const message = await redisGetJSON<BroadcastMessage>(KEYS.message(messageId));
    if (message) {
      message.stats.dismissals++;
      await redisSetJSON(KEYS.message(messageId), message);
    }

    return { success: true };
  } catch (error) {
    console.error('Dismiss message error:', error);
    return { success: false, error: 'Failed to dismiss message' };
  }
}

/**
 * Track impression (message was shown to user)
 */
export async function trackImpression(messageId: string): Promise<void> {
  try {
    // Increment impression count
    const message = await redisGetJSON<BroadcastMessage>(KEYS.message(messageId));
    if (message) {
      message.stats.impressions++;
      await redisSetJSON(KEYS.message(messageId), message);
    }
  } catch (error) {
    console.error('Track impression error:', error);
  }
}

/**
 * Update an existing broadcast message
 */
export async function updateBroadcast(
  id: string,
  updates: Partial<Omit<BroadcastMessage, 'id' | 'createdAt' | 'createdBy' | 'stats'>>
): Promise<{ success: boolean; message?: BroadcastMessage; error?: string }> {
  try {
    const existing = await redisGetJSON<BroadcastMessage>(KEYS.message(id));
    if (!existing) {
      return { success: false, error: 'Message not found' };
    }

    const updated: BroadcastMessage = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      stats: existing.stats,
    };

    await redisSetJSON(KEYS.message(id), updated);

    // Update priority in sorted set if changed
    if (updates.priority && updates.priority !== existing.priority) {
      const priorityScore = updated.priority === 'high' ? 1 : updated.priority === 'normal' ? 2 : 3;
      const score = priorityScore * 1e12 + updated.createdAt;
      await redis?.zadd?.(
        withPrefix(KEYS.activeList),
        { score, member: id }
      );
    }

    return { success: true, message: updated };
  } catch (error) {
    console.error('Update broadcast error:', error);
    return { success: false, error: 'Failed to update broadcast' };
  }
}

/**
 * Delete a broadcast message
 */
export async function deleteBroadcast(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Remove from active list
    await redis?.zrem?.(withPrefix(KEYS.activeList), id);

    // Delete message
    await redisDel(KEYS.message(id));

    return { success: true };
  } catch (error) {
    console.error('Delete broadcast error:', error);
    return { success: false, error: 'Failed to delete broadcast' };
  }
}

/**
 * Get statistics about the broadcast system
 */
export async function getBroadcastStats(): Promise<{
  totalMessages: number;
  totalImpressions: number;
  totalDismissals: number;
}> {
  try {
    const messages = await getActiveBroadcasts();
    
    const totalImpressions = messages.reduce((sum, msg) => sum + msg.stats.impressions, 0);
    const totalDismissals = messages.reduce((sum, msg) => sum + msg.stats.dismissals, 0);

    return {
      totalMessages: messages.length,
      totalImpressions,
      totalDismissals,
    };
  } catch (error) {
    console.error('Get broadcast stats error:', error);
    return {
      totalMessages: 0,
      totalImpressions: 0,
      totalDismissals: 0,
    };
  }
}

/**
 * Clean up expired messages
 */
async function cleanupExpiredMessages(expiredIds: string[]): Promise<void> {
  try {
    for (const id of expiredIds) {
      await redis?.zrem?.(withPrefix(KEYS.activeList), id);
      await redisDel(KEYS.message(id));
    }
  } catch (error) {
    console.error('Cleanup expired messages error:', error);
  }
}

