import { redis } from './redis';
import { nanoid } from 'nanoid';
import { ChatMessage, ChatRateLimit, ChatStats, AdminChatMessage } from './types';
import { resolvePrimaryName } from './ens-resolver';
import { ADDRESS_TRUNCATION } from './constants';
import { redisScanKeys } from './redis';

const CHAT_MESSAGE_TTL = 24 * 60 * 60; // 24 hours in seconds
const RATE_LIMIT_TTL = 60 * 60; // 1 hour in seconds
const SPAM_DETECTION_TTL = 30; // 30 seconds for duplicate message detection

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 3; // seconds between messages
const MAX_MESSAGE_LENGTH = 200;
const MIN_MESSAGE_LENGTH = 1;
const CHAT_MESSAGE_INDEX_KEY = 'chat:messages:index';

async function cleanupChatMessageIndex(now: number = Date.now()): Promise<void> {
  if (!redis) return;
  const cutoff = now - (CHAT_MESSAGE_TTL * 1000);
  await redis.zremrangebyscore(CHAT_MESSAGE_INDEX_KEY, '-inf', cutoff);
}

async function backfillChatMessageIndex(): Promise<void> {
  if (!redis) return;

  const legacyKeys = await redisScanKeys('chat:messages:*');
  if (legacyKeys.length === 0) return;

  const pipeline = redis.pipeline();
  for (const key of legacyKeys) {
    const timestamp = Number(key.split(':')[2] || 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    pipeline.zadd(CHAT_MESSAGE_INDEX_KEY, { score: timestamp, member: key });
  }
  await pipeline.exec();
  await cleanupChatMessageIndex();
}

async function getIndexedMessageKeys(start: number, stop: number): Promise<string[]> {
  if (!redis) return [];

  let keys = await redis.zrange(CHAT_MESSAGE_INDEX_KEY, start, stop, { rev: true }) as string[];
  if (keys.length === 0) {
    await backfillChatMessageIndex();
    keys = await redis.zrange(CHAT_MESSAGE_INDEX_KEY, start, stop, { rev: true }) as string[];
  }
  return keys;
}

async function loadMessages<T extends ChatMessage | AdminChatMessage>(keys: string[]): Promise<T[]> {
  if (!redis || keys.length === 0) {
    return [];
  }

  const dataArray = await redis.mget(...keys);
  const messages: T[] = [];

  for (let index = 0; index < keys.length; index += 1) {
    const data = dataArray[index];
    if (!data) {
      await redis.zrem(CHAT_MESSAGE_INDEX_KEY, keys[index]);
      continue;
    }

    try {
      const message = (typeof data === 'object' && data !== null)
        ? data as T
        : JSON.parse(String(data)) as T;

      if (!message.displayName) {
        const resolved = await resolvePrimaryName(message.address);
        if (resolved) {
          message.displayName = resolved;
        }
      }

      messages.push(message);
    } catch (error) {
      console.error('Error parsing chat message:', error);
    }
  }

  return messages;
}

// Helper function to create message hash for spam detection
function createMessageHash(message: string): string {
  // Simple hash function for message content
  return Buffer.from(message.toLowerCase().trim()).toString('base64');
}

// Helper function to format display name with consistent truncation
export function formatDisplayName(address: string): string {
  return `${address.slice(0, ADDRESS_TRUNCATION.prefix)}...${address.slice(-ADDRESS_TRUNCATION.suffix)}`;
}

// Store a new chat message
export async function storeMessage(address: string, message: string): Promise<ChatMessage> {
  if (!redis) {
    throw new Error('Redis client not available');
  }

  const messageId = nanoid();
  const timestamp = Date.now();

  let displayName = formatDisplayName(address);
  try {
    const resolved = await resolvePrimaryName(address);
    if (resolved) {
      displayName = resolved;
    }
  } catch (error) {
    console.warn('Failed to resolve display name', { address, error });
  }

  const chatMessage: ChatMessage = {
    id: messageId,
    address: address.toLowerCase(),
    message: message.trim(),
    timestamp,
    displayName,
  };

  // Store message with TTL
  const messageKey = `chat:messages:${timestamp}:${messageId}`;
  const pipeline = redis.pipeline();
  pipeline.set(messageKey, JSON.stringify(chatMessage), { ex: CHAT_MESSAGE_TTL });
  pipeline.zadd(CHAT_MESSAGE_INDEX_KEY, { score: timestamp, member: messageKey });
  pipeline.zremrangebyscore(CHAT_MESSAGE_INDEX_KEY, '-inf', timestamp - (CHAT_MESSAGE_TTL * 1000));
  await pipeline.exec();

  // Skip stats update to avoid potential hanging
  console.log('📊 Skipping stats update to avoid hanging');

  return chatMessage;
}

// Get recent messages (last 24 hours)
export async function getRecentMessages(limit: number = 50): Promise<ChatMessage[]> {
  if (!redis) {
    return [];
  }

  await cleanupChatMessageIndex();
  const recentKeys = await getIndexedMessageKeys(0, Math.max(limit - 1, 0));
  const messages = await loadMessages<ChatMessage>(recentKeys);

  // Sort by timestamp (ascending for display)
  return messages.sort((a, b) => a.timestamp - b.timestamp);
}

// Check rate limit for a user
export async function checkRateLimit(address: string): Promise<boolean> {
  if (!redis) {
    return true; // Allow if Redis is not available
  }

  const rateLimitKey = `chat:ratelimit:${address.toLowerCase()}`;
  const rateLimitData = await redis.get(rateLimitKey);

  if (!rateLimitData) return true;

  try {
    // Debug logging
    console.log('Rate limit data type:', typeof rateLimitData);
    console.log('Rate limit data value:', rateLimitData);

    let parsedData: ChatRateLimit;

    if (typeof rateLimitData === 'object' && rateLimitData !== null) {
      // If Redis returns an object directly, use it
      parsedData = rateLimitData as ChatRateLimit;
    } else if (typeof rateLimitData === 'string') {
      // If Redis returns a string, parse it
      parsedData = JSON.parse(rateLimitData);
    } else {
      // If it's something else, try to convert and parse
      const dataString = String(rateLimitData);
      parsedData = JSON.parse(dataString);
    }

    const now = Date.now();
    return (now - parsedData.lastMessage) >= (RATE_LIMIT_WINDOW * 1000);

  } catch (error) {
    console.error('Error in checkRateLimit:', error);
    console.error('Rate limit key:', rateLimitKey);
    return true;
  }
}

// Update rate limit for a user
export async function updateRateLimit(address: string): Promise<void> {
  if (!redis) {
    return; // Skip if Redis is not available
  }

  const rateLimitKey = `chat:ratelimit:${address.toLowerCase()}`;
  const now = Date.now();

  const rateLimitData: ChatRateLimit = {
    lastMessage: now,
    messageCount: 1
  };

  await redis.set(rateLimitKey, JSON.stringify(rateLimitData), { ex: RATE_LIMIT_TTL });
}

// Check for spam (duplicate messages)
export async function checkSpam(message: string, address: string): Promise<boolean> {
  if (!redis) {
    return false; // Allow if Redis is not available
  }

  const messageHash = createMessageHash(message);
  const spamKey = `chat:spam:${messageHash}`;
  const spamData = await redis.get(spamKey);

  if (!spamData) {
    // First time seeing this message, store it
    await redis.set(spamKey, JSON.stringify({
      count: 1,
      addresses: [address.toLowerCase()]
    }), { ex: SPAM_DETECTION_TTL });
    return false;
  }

  try {
    let spamInfo;
    if (typeof spamData === 'object' && spamData !== null) {
      spamInfo = spamData;
    } else if (typeof spamData === 'string') {
      spamInfo = JSON.parse(spamData);
    } else {
      const dataString = String(spamData);
      spamInfo = JSON.parse(dataString);
    }
    const { count, addresses } = spamInfo;

    // If same user is sending identical message within window, it's spam
    if (addresses.includes(address.toLowerCase())) {
      return true;
    }

    // If too many different users sending same message, it might be spam
    if (count >= 3) {
      return true;
    }

    // Update spam tracking
    await redis.set(spamKey, JSON.stringify({
      count: count + 1,
      addresses: [...addresses, address.toLowerCase()]
    }), { ex: SPAM_DETECTION_TTL });

    return false;
  } catch (error) {
    console.error('Error parsing spam data:', error);
    return false;
  }
}

// Validate message content
export function validateMessage(message: string): string | null {
  if (!message || typeof message !== 'string') {
    return 'Message is required';
  }

  const trimmed = message.trim();

  if (trimmed.length < MIN_MESSAGE_LENGTH) {
    return 'Message is too short';
  }

  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return `Message is too long (max ${MAX_MESSAGE_LENGTH} characters)`;
  }

  // Basic profanity filter (you can expand this)
  const profanityWords = ['spam', 'scam']; // Add more as needed
  const lowerMessage = trimmed.toLowerCase();

  for (const word of profanityWords) {
    if (lowerMessage.includes(word)) {
      return 'Message contains inappropriate content';
    }
  }

  return null;
}

// Get chat statistics
export async function getChatStats(): Promise<ChatStats> {
  if (!redis) {
    return {
      totalMessages: 0,
      activeUsers: 0,
      messagesLast24h: 0
    };
  }

  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  await cleanupChatMessageIndex(now);

  const totalMessages = await redis.zcard(CHAT_MESSAGE_INDEX_KEY);
  const messagesLast24h = await redis.zcount(CHAT_MESSAGE_INDEX_KEY, oneDayAgo, '+inf');
  const recentKeys = await redis.zrange(CHAT_MESSAGE_INDEX_KEY, oneDayAgo, '+inf', { byScore: true }) as string[];
  const uniqueUsers = new Set<string>();

  const recentMessages = await loadMessages<ChatMessage>(recentKeys);
  for (const message of recentMessages) {
    if (message.address) {
      uniqueUsers.add(message.address);
    }
  }

  return {
    totalMessages,
    activeUsers: uniqueUsers.size,
    messagesLast24h
  };
}

// Admin functions
export async function getAllMessagesForAdmin(): Promise<AdminChatMessage[]> {
  if (!redis) {
    return [];
  }

  await cleanupChatMessageIndex();
  const keys = await getIndexedMessageKeys(0, -1);
  return loadMessages<AdminChatMessage>(keys);
}

// Delete a specific message
export async function deleteMessage(messageId: string, timestamp: number): Promise<boolean> {
  if (!redis) {
    return false;
  }

  const key = `chat:messages:${timestamp}:${messageId}`;
  const deleted = await redis.del(key);
  await redis.zrem(CHAT_MESSAGE_INDEX_KEY, key);
  return Number(deleted) > 0;
}

// Delete all messages
export async function deleteAllMessages(): Promise<number> {
  if (!redis) {
    return 0;
  }

  await cleanupChatMessageIndex();
  const keys = await redis.zrange(CHAT_MESSAGE_INDEX_KEY, 0, -1) as string[];

  if (keys.length === 0) return 0;

  const pipeline = redis.pipeline();
  pipeline.del(...keys);
  pipeline.del(CHAT_MESSAGE_INDEX_KEY);

  // Reset stats
  pipeline.del('chat:stats:total');
  await pipeline.exec();

  return keys.length;
}

// Clean up old data (called periodically)
export async function cleanupOldData(): Promise<void> {
  if (!redis) {
    return;
  }

  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);

  // Clean old messages
  const oldMessageKeys = await redis.zrange(CHAT_MESSAGE_INDEX_KEY, '-inf', oneDayAgo - 1, { byScore: true }) as string[];

  if (oldMessageKeys.length > 0) {
    const pipeline = redis.pipeline();
    pipeline.del(...oldMessageKeys);
    pipeline.zremrangebyscore(CHAT_MESSAGE_INDEX_KEY, '-inf', oneDayAgo - 1);
    await pipeline.exec();
  }

  // Clean old spam tracking
  const spamKeys = await redisScanKeys('chat:spam:*');
  if (spamKeys.length > 0) {
    await redis.del(...spamKeys);
  }
}
