import { redis, redisGetJSON, redisSetJSON, withPrefix, redisDel, redisIncrBy, redisTTL, redisExpire, redisPersist } from './redis';
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
  statsImpressions: (id: string) => `pixotchi:broadcast:stats:impressions:${id}`,
  statsDismissals: (id: string) => `pixotchi:broadcast:stats:dismissals:${id}`,
};

async function setCounterInitialValue(key: string, ttlSeconds?: number | null) {
  if (!redis) return;
  const namespaced = withPrefix(key);
  await redis.set(namespaced, '0');
  if (typeof ttlSeconds === 'number') {
    if (ttlSeconds > 0) {
      await redisExpire(key, ttlSeconds);
    } else if (ttlSeconds === 0) {
      await redisExpire(key, 1);
    } else if (ttlSeconds < 0) {
      await redisPersist(key);
    }
  } else if (ttlSeconds === null) {
    await redisPersist(key);
  }
}

async function syncCounterTTL(key: string, ttlSeconds: number | null) {
  if (ttlSeconds === null) return;
  if (ttlSeconds > 0) {
    await redisExpire(key, ttlSeconds);
  } else if (ttlSeconds === -1) {
    await redisPersist(key);
  }
}

async function getCounterValue(key: string): Promise<number> {
  if (!redis) return 0;
  const raw = await redis.get(withPrefix(key));
  if (raw == null) return 0;
  const num = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Create a new broadcast message
 */
export async function createBroadcast(data: {
  content: string;
  title?: string;
  expiresIn?: number | null;
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
    const expiresAt = typeof data.expiresIn === 'number' && data.expiresIn > 0
      ? now + (data.expiresIn * 1000)
      : undefined;

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
    if (typeof data.expiresIn === 'number' && data.expiresIn > 0) {
      await redisSetJSON(KEYS.message(id), message, data.expiresIn);
    } else {
      await redisSetJSON(KEYS.message(id), message);
      if (redis) {
        await redisPersist(KEYS.message(id));
      }
    }

    if (redis) {
      const ttlSeed = typeof data.expiresIn === 'number' ? data.expiresIn : data.expiresIn ?? null;
      await setCounterInitialValue(KEYS.statsImpressions(id), ttlSeed);
      await setCounterInitialValue(KEYS.statsDismissals(id), ttlSeed);
    }

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

    const messagesWithStats = await Promise.all(
      validMessages.map(async (msg) => {
        const [impressions, dismissals] = await Promise.all([
          getCounterValue(KEYS.statsImpressions(msg.id)),
          getCounterValue(KEYS.statsDismissals(msg.id)),
        ]);
        return {
          ...msg,
          stats: {
            impressions,
            dismissals,
          },
        } as BroadcastMessage;
      })
    );

    return messagesWithStats;
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

    await redis?.sadd?.(
      withPrefix(KEYS.dismissedByUser(normalizedAddress)),
      messageId
    );

    await redisIncrBy(KEYS.statsDismissals(messageId), 1);

    const ttl = await redisTTL(KEYS.message(messageId));
    await syncCounterTTL(KEYS.statsDismissals(messageId), ttl);
    await syncCounterTTL(KEYS.statsImpressions(messageId), ttl);

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
    await redisIncrBy(KEYS.statsImpressions(messageId), 1);
    const ttl = await redisTTL(KEYS.message(messageId));
    await syncCounterTTL(KEYS.statsImpressions(messageId), ttl);
    await syncCounterTTL(KEYS.statsDismissals(messageId), ttl);
  } catch (error) {
    console.error('Track impression error:', error);
  }
}

/**
 * Update an existing broadcast message
 */
export async function updateBroadcast(
  id: string,
  updates: Partial<Omit<BroadcastMessage, 'id' | 'createdAt' | 'createdBy' | 'stats'>> & { expiresIn?: number | null }
): Promise<{ success: boolean; message?: BroadcastMessage; error?: string }> {
  try {
    const existing = await redisGetJSON<BroadcastMessage>(KEYS.message(id));
    if (!existing) {
      return { success: false, error: 'Message not found' };
    }

    const { expiresIn, ...rest } = updates;

    let expiresAt = existing.expiresAt;
    if (typeof expiresIn === 'number') {
      if (expiresIn > 0) {
        expiresAt = Date.now() + expiresIn * 1000;
      } else {
        expiresAt = undefined;
      }
    } else if (expiresIn === null) {
      expiresAt = undefined;
    }

    const updated: BroadcastMessage = {
      ...existing,
      ...rest,
      id: existing.id,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      expiresAt,
      stats: existing.stats,
    };

    let ttlSeconds: number | undefined;
    if (expiresAt) {
      const diff = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      ttlSeconds = diff > 0 ? diff : 1;
    }

    if (typeof ttlSeconds === 'number') {
      await redisSetJSON(KEYS.message(id), updated, ttlSeconds);
    } else {
      await redisSetJSON(KEYS.message(id), updated);
      await redisPersist(KEYS.message(id));
    }

    if (typeof ttlSeconds === 'number') {
      await syncCounterTTL(KEYS.statsImpressions(id), ttlSeconds);
      await syncCounterTTL(KEYS.statsDismissals(id), ttlSeconds);
    } else if (ttlSeconds === undefined) {
      await redisPersist(KEYS.statsImpressions(id));
      await redisPersist(KEYS.statsDismissals(id));
    }

    // Update priority in sorted set if changed
    if (rest.priority && rest.priority !== existing.priority) {
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
    await redisDel(KEYS.statsImpressions(id));
    await redisDel(KEYS.statsDismissals(id));

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
      await redisDel(KEYS.statsImpressions(id));
      await redisDel(KEYS.statsDismissals(id));
    }
  } catch (error) {
    console.error('Cleanup expired messages error:', error);
  }
}

