import { redis } from './redis';
import { nanoid } from 'nanoid';
import { ChatMessage, ChatRateLimit, ChatStats, AdminChatMessage } from './types';

const CHAT_MESSAGE_TTL = 24 * 60 * 60; // 24 hours in seconds
const RATE_LIMIT_TTL = 60 * 60; // 1 hour in seconds
const ENS_CACHE_TTL = 24 * 60 * 60; // 24 hours in seconds
const SPAM_DETECTION_TTL = 30; // 30 seconds for duplicate message detection

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 3; // seconds between messages
const MAX_MESSAGE_LENGTH = 200;
const MIN_MESSAGE_LENGTH = 1;

// Helper function to create message hash for spam detection
function createMessageHash(message: string): string {
  // Simple hash function for message content
  return Buffer.from(message.toLowerCase().trim()).toString('base64');
}

// Helper function to format display name
export function formatDisplayName(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Store a new chat message
export async function storeMessage(
  address: string, 
  message: string, 
  type?: 'text' | 'cast_share',
  castData?: any
): Promise<ChatMessage> {
  if (!redis) {
    throw new Error('Redis client not available');
  }

  const messageId = nanoid();
  const timestamp = Date.now();
  
  const chatMessage: ChatMessage = {
    id: messageId,
    address: address.toLowerCase(),
    message: message.trim(),
    timestamp,
    displayName: formatDisplayName(address), // Client-side OnchainKit will handle names
    type: type || 'text', // Default to 'text' for backwards compatibility
    ...(castData && { castData }) // Include castData if provided
  };

  // Store message with TTL
  const messageKey = `chat:messages:${timestamp}:${messageId}`;
  await redis.set(messageKey, JSON.stringify(chatMessage), { ex: CHAT_MESSAGE_TTL });

  // Skip stats update to avoid potential hanging
  console.log('📊 Skipping stats update to avoid hanging');

  return chatMessage;
}

// Get recent messages (last 24 hours)
export async function getRecentMessages(limit: number = 50): Promise<ChatMessage[]> {
  if (!redis) {
    return [];
  }

  const keys = await redis.keys('chat:messages:*');
  
  if (keys.length === 0) return [];
  
  // Sort keys by timestamp (descending)
  keys.sort((a, b) => {
    const timestampA = parseInt(a.split(':')[2]);
    const timestampB = parseInt(b.split(':')[2]);
    return timestampB - timestampA;
  });

  // Get the most recent messages using simple redis.get() calls (like invite system)
  const recentKeys = keys.slice(0, limit);
  const messages: ChatMessage[] = [];
  
  for (const key of recentKeys) {
    try {
      const data = await redis.get(key);
      if (data) {
        let message;
        if (typeof data === 'object' && data !== null) {
          message = data;
        } else if (typeof data === 'string') {
          message = JSON.parse(data);
        } else {
          const dataString = String(data);
          message = JSON.parse(dataString);
        }
        messages.push(message);
      }
    } catch (error) {
      console.error('Error parsing chat message:', error);
    }
  }

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

// Store ENS name with cache
export async function cacheENSName(address: string, ens: string): Promise<void> {
  if (!redis) {
    return; // Skip if Redis is not available
  }

  const ensKey = `chat:ens:${address.toLowerCase()}`;
  await redis.setex(ensKey, ENS_CACHE_TTL, ens);
}

// Get cached ENS name
export async function getCachedENSName(address: string): Promise<string | null> {
  if (!redis) {
    return null; // Return null if Redis is not available
  }

  const ensKey = `chat:ens:${address.toLowerCase()}`;
  return await redis.get(ensKey);
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

  const keys = await redis.keys('chat:messages:*');
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  
  // Count messages from last 24h
  let messagesLast24h = 0;
  const uniqueUsers = new Set<string>();
  
  for (const key of keys) {
    const timestamp = parseInt(key.split(':')[2]);
    if (timestamp >= oneDayAgo) {
      messagesLast24h++;
      
      // Get user address for unique count
      try {
        const messageData = await redis.get(key);
        if (messageData) {
          let message;
          if (typeof messageData === 'object' && messageData !== null) {
            message = messageData;
          } else if (typeof messageData === 'string') {
            message = JSON.parse(messageData);
          } else {
            const dataString = String(messageData);
            message = JSON.parse(dataString);
          }
          uniqueUsers.add(message.address);
        }
      } catch (error) {
        console.error('Error parsing message for stats:', error);
      }
    }
  }
  
  return {
    totalMessages: keys.length,
    activeUsers: uniqueUsers.size,
    messagesLast24h
  };
}

// Admin functions
export async function getAllMessagesForAdmin(): Promise<AdminChatMessage[]> {
  if (!redis) {
    return [];
  }

  const keys = await redis.keys('chat:messages:*');
  
  if (keys.length === 0) return [];
  
  // Sort keys by timestamp (descending)
  keys.sort((a, b) => {
    const timestampA = parseInt(a.split(':')[2]);
    const timestampB = parseInt(b.split(':')[2]);
    return timestampB - timestampA;
  });

  // Use simple redis.get() calls instead of pipeline for compatibility
  const results: any[] = [];
  
  for (const key of keys) {
    try {
      const data = await redis.get(key);
      results.push([null, data]); // Mimic pipeline result format [error, data]
    } catch (error) {
      results.push([error, null]);
    }
  }
  const messages: AdminChatMessage[] = [];
  
  if (results) {
    for (const result of results) {
      if (result && Array.isArray(result) && result[1]) {
        try {
          let message;
          if (typeof result[1] === 'object' && result[1] !== null) {
            message = result[1];
          } else if (typeof result[1] === 'string') {
            message = JSON.parse(result[1]);
          } else {
            const dataString = String(result[1]);
            message = JSON.parse(dataString);
          }
          
          // Check if message might be spam
          const messageHash = createMessageHash(message.message);
          let isSpam = false;
          let similarCount = 0;
          
          if (redis) {
            const spamData = await redis.get(`chat:spam:${messageHash}`);
            if (spamData) {
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
                const { count } = spamInfo;
                similarCount = count;
                isSpam = count > 2;
              } catch (error) {
                console.error('Error parsing spam data for admin:', error);
              }
            }
          }
          
          messages.push({
            ...message,
            isSpam,
            similarCount
          });
        } catch (error) {
          console.error('Error parsing chat message for admin:', error);
        }
      }
    }
  }

  return messages;
}

// Delete a specific message
export async function deleteMessage(messageId: string, timestamp: number): Promise<boolean> {
  if (!redis) {
    return false;
  }

  const keys = await redis.keys(`chat:messages:${timestamp}:${messageId}`);
  
  if (keys.length === 0) return false;
  
  await redis.del(keys[0]);
  return true;
}

// Delete all messages
export async function deleteAllMessages(): Promise<number> {
  if (!redis) {
    return 0;
  }

  const keys = await redis.keys('chat:messages:*');
  
  if (keys.length === 0) return 0;
  
  await redis.del(...keys);
  
  // Reset stats
  await redis.del('chat:stats:total');
  
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
  const messageKeys = await redis.keys('chat:messages:*');
  const oldMessageKeys = messageKeys.filter(key => {
    const timestamp = parseInt(key.split(':')[2]);
    return timestamp < oneDayAgo;
  });
  
  if (oldMessageKeys.length > 0) {
    await redis.del(...oldMessageKeys);
  }
  
  // Clean old spam tracking
  const spamKeys = await redis.keys('chat:spam:*');
  if (spamKeys.length > 0) {
    await redis.del(...spamKeys);
  }
}