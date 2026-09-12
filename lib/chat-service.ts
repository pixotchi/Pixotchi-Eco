import { redis } from './redis';
import { nanoid } from 'nanoid';
import { ChatMessage, ChatStats, AdminChatMessage } from './types';
import { ChatAdmissionError, STORE_PUBLIC_CHAT_MESSAGE_LUA, DELETE_PUBLIC_CHAT_MESSAGE_LUA } from './chat-message-admission';
import { resolvePrimaryName } from './ens-resolver';
import { ADDRESS_TRUNCATION } from './constants';
import { withPrefix } from './redis';

type RedisScanResponse =
  | [cursor: string | number, keys: string[]]
  | { cursor?: string | number; keys?: string[] };

type RedisScanClient = {
  scan: (cursor: number, options: { match: string; count: number }) => Promise<RedisScanResponse>;
};

const CHAT_MESSAGE_TTL = 24 * 60 * 60; // 24 hours in seconds
const RATE_LIMIT_TTL = 60 * 60; // 1 hour in seconds
const SPAM_DETECTION_TTL = 30; // 30 seconds for duplicate message detection

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 3; // seconds between messages
const MAX_MESSAGE_LENGTH = 200;
const MIN_MESSAGE_LENGTH = 1;
const CHAT_MESSAGE_INDEX_KEY = 'chat:messages:index';

function hasScanClient(client: UntypedValue): client is RedisScanClient {
  return typeof client === 'object'
    && client !== null
    && typeof (client as { scan?: UntypedValue }).scan === 'function';
}

function normalizeScanCursor(cursor: string | number | undefined): number {
  const value = typeof cursor === 'string' ? parseInt(cursor, 10) : Number(cursor ?? 0);
  return Number.isFinite(value) ? value : 0;
}

async function scanRawKeys(pattern: string, count: number = 1000): Promise<string[]> {
  if (!redis) return [];

  try {
    const scanClient: UntypedValue = redis;
    if (!hasScanClient(scanClient)) {
      const keys = await redis.keys(pattern);
      return keys.map(String);
    }

    let cursor = 0;
    const results: string[] = [];

    do {
      const resp = await scanClient.scan(cursor, { match: pattern, count });
      if (Array.isArray(resp)) {
        cursor = normalizeScanCursor(resp[0]);
        results.push(...resp[1].map(String));
      } else if (resp && typeof resp === 'object' && 'cursor' in resp) {
        cursor = normalizeScanCursor(resp.cursor);
        results.push(...(resp.keys || []).map(String));
      } else {
        break;
      }
    } while (cursor !== 0);

    return results;
  } catch {
    try {
      const keys = await redis.keys(pattern);
      return keys.map(String);
    } catch {
      return [];
    }
  }
}

async function scanChatKeys(pattern: string): Promise<string[]> {
  const rawPattern = pattern;
  const prefixedPattern = withPrefix(pattern);

  const [rawKeys, prefixedKeys] = await Promise.all([
    scanRawKeys(rawPattern),
    scanRawKeys(prefixedPattern),
  ]);

  return Array.from(new Set([...rawKeys, ...prefixedKeys]));
}

function extractChatMessageTimestamp(key: string): number {
  const match = key.match(/(?:^|:)chat:messages:(\d+):/);
  if (!match) return 0;

  const timestamp = Number(match[1]);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function cleanupChatMessageIndex(now: number = Date.now()): Promise<void> {
  if (!redis) return;
  const cutoff = now - (CHAT_MESSAGE_TTL * 1000);
  await redis.zremrangebyscore(CHAT_MESSAGE_INDEX_KEY, '-inf', cutoff);
}

async function backfillChatMessageIndex(): Promise<void> {
  if (!redis) return;

  const legacyKeys = await scanChatKeys('chat:messages:*');
  if (legacyKeys.length === 0) return;

  const stableTimestamps = new Map<string, number>();
  const stableKeys = legacyKeys.filter(key => /(?:^|:)chat:messages:v2:/.test(key));
  for (let i = 0; i < stableKeys.length; i += 100) {
    const batch = stableKeys.slice(i, i + 100);
    const values = await redis.mget(...batch);
    values.forEach((raw, index) => {
      try {
        const row = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (row && typeof row === 'object' && 'timestamp' in row && typeof row.timestamp === 'number') {
          stableTimestamps.set(batch[index], row.timestamp);
        }
      } catch { /* Invalid/expired records cannot be added to the index. */ }
    });
  }

  const pipeline = redis.pipeline();
  for (const key of legacyKeys) {
    const timestamp = stableTimestamps.get(key) ?? extractChatMessageTimestamp(key);
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
export async function storeMessage(address: string, message: string, requestId?: string): Promise<ChatMessage> {
  if (!redis) {
    throw new Error('Redis client not available');
  }

  if (requestId && !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) throw new Error('Invalid message ID');
  const messageId = requestId || nanoid();

  let displayName = formatDisplayName(address);
  try {
    const resolved = await resolvePrimaryName(address);
    if (resolved) {
      displayName = resolved;
    }
  } catch (error) {
    console.warn('Failed to resolve display name', { address, error });
  }

  // Take time after optional name lookup so a slow lookup cannot age the cooldown.
  const timestamp = Date.now();
  const chatMessage: ChatMessage = {
    id: messageId,
    address: address.toLowerCase(),
    message: message.trim(),
    timestamp,
    displayName,
  };

  // Stable per-wallet key permits transport retries without a second message.
  const messageKey = `chat:messages:v2:${address.toLowerCase()}:${messageId}`;
  const result = await redis.eval<[number, string, number, number, number, number], [number, string | ChatMessage]>(STORE_PUBLIC_CHAT_MESSAGE_LUA, [
    messageKey, CHAT_MESSAGE_INDEX_KEY, `chat:ratelimit:${address.toLowerCase()}`,
    `chat:spam:${createMessageHash(message)}`,
  ], [timestamp, JSON.stringify(chatMessage), RATE_LIMIT_WINDOW * 1000,
    CHAT_MESSAGE_TTL, RATE_LIMIT_TTL, SPAM_DETECTION_TTL]);
  if (result[0] === -1) throw new ChatAdmissionError('cooldown');
  if (result[0] === -2) throw new ChatAdmissionError('duplicate');
  if (result[0] === -3) throw new ChatAdmissionError('idempotency_conflict');
  if (result[0] !== 1 || !result[1]) throw new Error('Chat persistence was not confirmed');
  return typeof result[1] === 'string' ? JSON.parse(result[1]) as ChatMessage : result[1];
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

  if (typeof messageId !== 'string' || !Number.isSafeInteger(timestamp) || timestamp <= 0) return false;
  const legacyKey = `chat:messages:${timestamp}:${messageId}`;
  const indexed = await redis.zrange(CHAT_MESSAGE_INDEX_KEY, timestamp, timestamp, { byScore: true }) as string[];
  const candidates = Array.from(new Set([legacyKey, withPrefix(legacyKey), ...indexed]))
    .filter(key => key.endsWith(`:${messageId}`));
  const values = await redis.mget(...candidates);
  const matches = candidates.filter((_, index) => {
    try {
      const value = values[index];
      const message = typeof value === 'string' ? JSON.parse(value) : value;
      return message?.id === messageId && message?.timestamp === timestamp;
    } catch { return false; }
  });
  // The legacy admin API identifies messages by ID + time. Refuse ambiguity
  // between wallets rather than deleting a different user's message.
  if (matches.length !== 1) return false;
  return Number(await redis.eval(DELETE_PUBLIC_CHAT_MESSAGE_LUA,
    [matches[0], CHAT_MESSAGE_INDEX_KEY], [messageId, timestamp])) === 1;
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
  const spamKeys = await scanChatKeys('chat:spam:*');
  if (spamKeys.length > 0) {
    await redis.del(...spamKeys);
  }
}
