import { redis } from './redis';
import { nanoid } from 'nanoid';
import { AIChatMessage, AIConversation, AIUsageStats, AICostMetrics } from './types';
import { getCurrentAIProvider, getCurrentModelConfig, validateAIConfig } from './ai-config';
import { buildAIPrompt, generateConversationTitle } from './ai-context';
import { formatDisplayName } from './chat-service';
import { getUserGameStats, formatStatsForAI } from './user-stats-service';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const AI_MESSAGE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
const AI_RATE_LIMIT_TTL = 60 * 60; // 1 hour in seconds
const AI_USAGE_TTL = 24 * 60 * 60; // 24 hours in seconds

// Rate limiting configuration
const AI_RATE_LIMIT_WINDOW = 10; // 10 seconds between AI messages
const MAX_AI_MESSAGE_LENGTH = 300;
const MIN_AI_MESSAGE_LENGTH = 2;

// Provider instances
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

// Helper to get the SDK model instance
function getSDKModel() {
  const providerName = getCurrentAIProvider();
  const config = getCurrentModelConfig();
  
  if (providerName === 'openai') {
    return openai(config.model);
  } else if (providerName === 'claude') {
    // Note: @ai-sdk/anthropic handles cache control automatically if headers/structured prompts are used,
    // but we will rely on its standard behavior for now.
    return anthropic(config.model);
  } else if (providerName === 'google') {
    return google(config.model);
  }
  throw new Error(`Unknown provider: ${providerName}`);
}

// Validate AI message content
export function validateAIMessage(message: string): string | null {
  if (!message || typeof message !== 'string') {
    return 'Message is required';
  }
  
  const trimmed = message.trim();
  
  if (trimmed.length < MIN_AI_MESSAGE_LENGTH) {
    return 'Message is too short';
  }
  
  if (trimmed.length > MAX_AI_MESSAGE_LENGTH) {
    return `Message is too long (max ${MAX_AI_MESSAGE_LENGTH} characters)`;
  }
  
  return null;
}

// Check AI rate limit for a user
export async function checkAIRateLimit(address: string): Promise<boolean> {
  if (!redis) {
    console.warn('Redis unavailable - failing open for rate limit');
    return true; // Fail open
  }

  try {
    const rateLimitKey = `ai:ratelimit:${address.toLowerCase()}`;
    const lastMessage = await redis.get(rateLimitKey);
    
    if (!lastMessage) return true;
    
    // Validate that lastMessage is a valid timestamp
    if (typeof lastMessage !== 'string' && typeof lastMessage !== 'number') {
      console.warn('Invalid rate limit data type');
      return true; // Fail open
    }
    
    const now = Date.now();
    const lastMessageTime = parseInt(String(lastMessage), 10);
    if (isNaN(lastMessageTime)) {
      console.warn('Invalid rate limit timestamp');
      return true; // Fail open
    }
    
    return (now - lastMessageTime) >= (AI_RATE_LIMIT_WINDOW * 1000);
  } catch (error) {
    console.error('Rate limit check failed:', error);
    return true; // Fail open on error
  }
}

// Update AI rate limit for a user
export async function updateAIRateLimit(address: string): Promise<void> {
  if (!redis) {
    return; // Skip if Redis is not available
  }

  try {
    const rateLimitKey = `ai:ratelimit:${address.toLowerCase()}`;
    const now = Date.now();
    await redis.set(rateLimitKey, now.toString(), { ex: AI_RATE_LIMIT_TTL });
  } catch (error) {
    console.warn('Failed to update rate limit:', error);
  }
}

// Get or create conversation for user
export async function getOrCreateConversation(address: string, firstMessage?: string): Promise<string> {
  if (!redis) {
    throw new Error('Redis client not available');
  }

  const lowerAddress = address.toLowerCase();
  const activeConversationKey = `ai:user_active_conversation:${lowerAddress}`;

  try {
    // Try to get active conversation ID from index
    const activeId = await redis.get(activeConversationKey);
    if (activeId && typeof activeId === 'string') {
      return activeId;
    }

    // Fallback: check legacy keys pattern if no index found
    // This provides backward compatibility during migration
    const conversationKeys = await redis.keys(`ai:conversations:${lowerAddress}:*`);
    if (conversationKeys.length > 0) {
      const legacyId = conversationKeys[0].split(':')[3];
      // Index it for next time
      await redis.set(activeConversationKey, legacyId, { ex: AI_MESSAGE_TTL });
      await redis.sadd('ai:conversations:index', conversationKeys[0]);
      return legacyId;
    }
  } catch (error) {
    console.warn('Error checking existing conversations:', error);
  }

  // Create new conversation
  const conversationId = nanoid();
  const now = Date.now();
  
  const conversation: AIConversation = {
    id: conversationId,
    address: lowerAddress,
    title: firstMessage ? generateConversationTitle(firstMessage) : 'New Conversation',
    createdAt: now,
    lastMessageAt: now,
    messageCount: 0,
    model: getCurrentModelConfig().model,
    totalTokens: 0,
  };

  const conversationKey = `ai:conversations:${lowerAddress}:${conversationId}`;
  
  try {
    // Use pipeline for atomic updates
    const pipeline = redis.pipeline();
    pipeline.set(conversationKey, JSON.stringify(conversation), { ex: AI_MESSAGE_TTL });
    pipeline.set(activeConversationKey, conversationId, { ex: AI_MESSAGE_TTL });
    pipeline.sadd('ai:conversations:index', conversationKey);
    await pipeline.exec();
  } catch (error) {
    console.error('Error creating conversation:', error);
    throw error;
  }

  return conversationId;
}

// Store AI chat message
export async function storeAIMessage(
  address: string, 
  message: string, 
  type: 'user' | 'assistant',
  conversationId: string,
  tokensUsed: number = 0
): Promise<AIChatMessage> {
  if (!redis) {
    throw new Error('Redis client not available');
  }

  const messageId = nanoid();
  const timestamp = Date.now();
  const lowerAddress = address.toLowerCase();
  
  const aiMessage: AIChatMessage = {
    id: messageId,
    conversationId,
    address: lowerAddress,
    message: message.trim(),
    timestamp,
    type,
    model: getCurrentModelConfig().model,
    tokensUsed,
    displayName: type === 'assistant' ? 'Neural Seed' : formatDisplayName(address)
  };

  const messageKey = `ai:messages:${conversationId}:${timestamp}:${messageId}`;
  const conversationKey = `ai:conversations:${lowerAddress}:${conversationId}`;
  const listKey = `ai:conversation_messages:${conversationId}`;

  try {
    const pipeline = redis.pipeline();

    // 1. Store message object
    pipeline.set(messageKey, JSON.stringify(aiMessage), { ex: AI_MESSAGE_TTL });
    
    // 2. Add key to ordered list (replaces KEYS scan)
    pipeline.rpush(listKey, messageKey);
    pipeline.expire(listKey, AI_MESSAGE_TTL);

    // 3. Update conversation metadata
    const conversationData = await redis.get(conversationKey);
    
    if (conversationData) {
      let conversation: AIConversation;
      if (typeof conversationData === 'object') {
        conversation = conversationData as AIConversation;
      } else {
        conversation = JSON.parse(conversationData as string);
      }
      
      conversation.lastMessageAt = timestamp;
      conversation.messageCount += 1;
      conversation.totalTokens += tokensUsed;
      
      pipeline.set(conversationKey, JSON.stringify(conversation), { ex: AI_MESSAGE_TTL });
    }

    await pipeline.exec();
  } catch (error) {
    console.error('Error storing AI message:', error);
    throw error;
  }

  return aiMessage;
}

// Get conversation messages
export async function getAIConversationMessages(conversationId: string, limit: number = 50): Promise<AIChatMessage[]> {
  if (!redis) {
    return [];
  }

  try {
    const listKey = `ai:conversation_messages:${conversationId}`;
    
    // 1. Try to get from new List structure first
    let messageKeys = await redis.lrange(listKey, -limit, -1);
    
    // 2. Fallback to KEYS if List is empty (migration path)
    if (messageKeys.length === 0) {
      const legacyKeys = await redis.keys(`ai:messages:${conversationId}:*`);
      if (legacyKeys.length > 0) {
        // Sort keys by timestamp (ascending)
        legacyKeys.sort((a, b) => {
          const timestampA = parseInt(a.split(':')[3] || '0');
          const timestampB = parseInt(b.split(':')[3] || '0');
          return timestampA - timestampB;
        });
        messageKeys = legacyKeys.slice(-limit);
        
        // Optional: Backfill list for future speed
        if (messageKeys.length > 0) {
          await redis.rpush(listKey, ...messageKeys);
          await redis.expire(listKey, AI_MESSAGE_TTL);
        }
      }
    }

    if (messageKeys.length === 0) return [];

    // 3. Fetch all message data in one batch
    const dataArray = await redis.mget(...messageKeys);
    
    const messages: AIChatMessage[] = [];
    for (const data of dataArray) {
      if (data) {
        try {
          const message = typeof data === 'object' ? data : JSON.parse(data as string);
          messages.push(message as AIChatMessage);
        } catch (e) {
          // Ignore malformed messages
        }
      }
    }

    return messages;
  } catch (error) {
    console.error('Error fetching AI messages:', error);
    return [];
  }
}

// Send message to AI and get response
export async function sendAIMessage(address: string, message: string): Promise<{
  userMessage: AIChatMessage;
  aiResponse: AIChatMessage;
}> {
  // Validate configuration
  const configValidation = validateAIConfig();
  if (!configValidation.valid) {
    throw new Error(`AI configuration error: ${configValidation.errors.join(', ')}`);
  }

  const conversationId = await getOrCreateConversation(address, message);
  
  // Get conversation history for context
  const historyMessages = await getAIConversationMessages(conversationId, 10);
  const conversationHistory = historyMessages
    .map(msg => `${msg.type === 'user' ? 'User' : 'Assistant'}: ${msg.message}`)
    .join('\n');

  // Fetch user game stats
  let userStats: string | undefined;
  try {
    console.log('📊 Fetching user stats for AI context...');
    const stats = await getUserGameStats(address);
    userStats = formatStatsForAI(stats);
    console.log('✅ User stats fetched successfully');
  } catch (error) {
    console.warn('⚠️ Failed to fetch user stats, continuing without:', error);
    userStats = undefined;
  }

  // Build structured prompt with proper system/user separation + user stats
  const promptData = buildAIPrompt(message, conversationHistory, userStats);

  // Store user message
  const userMessage = await storeAIMessage(address, message, 'user', conversationId);

  try {
    console.log('📝 AI Prompt Info:', {
      messageLength: message.length,
      hasHistory: !!conversationHistory,
      provider: getCurrentAIProvider(),
      model: getCurrentModelConfig().model,
    });

    const model = getSDKModel();
    
    // Map our promptData structure to the SDK's generateText input
    let system = '';
    let prompt = '';
    
    if (typeof promptData === 'string') {
      prompt = promptData;
    } else if ('systemBlocks' in promptData && promptData.systemBlocks) {
      system = promptData.systemBlocks.map(b => b.text).join('\n\n');
      prompt = promptData.userContent;
    } else {
      // @ts-ignore - legacy structure check
      system = promptData.system || '';
      // @ts-ignore
      prompt = promptData.userContent || '';
    }

    // Use Vercel AI SDK generateText
    // Note: maxTokens and temperature are not supported as direct properties in AI SDK v5
    // They can be configured at the model level if needed
    const result = await generateText({
      model,
      system: system || undefined, // only pass if present
      prompt,
    });

    const response = result.text;
    // AI SDK v5 uses inputTokens and outputTokens instead of promptTokens and completionTokens
    const tokensUsed = (result.usage.inputTokens || 0) + (result.usage.outputTokens || 0);

    console.log('✅ AI Response Received:', {
      responseLength: response.length,
      tokensUsed,
      responsePreview: response.substring(0, 100) + (response.length > 100 ? '...' : ''),
    });

    // Store AI response
    const aiResponse = await storeAIMessage(address, response, 'assistant', conversationId, tokensUsed);

    // Track usage
    await trackAIUsage(address, tokensUsed);

    return { userMessage, aiResponse };
  } catch (error) {
    console.error('AI Provider Error:', {
      provider: getCurrentAIProvider(),
      model: getCurrentModelConfig().model,
      error: error instanceof Error ? error.message : String(error),
      address: address.slice(0, 6) + '...' 
    });
    
    // Store error response
    const errorResponse = await storeAIMessage(
      address, 
      'Sorry, I encountered an error while processing your request. Please try again later.',
      'assistant',
      conversationId
    );

    return { userMessage, aiResponse: errorResponse };
  }
}

// Track AI usage
export async function trackAIUsage(address: string, tokensUsed: number): Promise<void> {
  if (!redis) return;

  const today = new Date().toISOString().split('T')[0];
  const usageKey = `ai:usage:${address.toLowerCase()}:${today}`;
  const dateIndexKey = `ai:usage_index:${today}`;
  
  try {
    const pipeline = redis.pipeline();
    
    // 1. Get current usage
    const currentUsage = await redis.get(usageKey);
    let totalTokens = tokensUsed;
    let totalMessages = 1;
    
    if (currentUsage) {
      const usage = typeof currentUsage === 'object' ? currentUsage : JSON.parse(currentUsage as string);
      totalTokens += usage.tokens || 0;
      totalMessages += usage.messages || 0;
    }
    
    // 2. Update usage
    pipeline.set(usageKey, JSON.stringify({
      date: today,
      tokens: totalTokens,
      messages: totalMessages,
    }), { ex: AI_USAGE_TTL });

    // 3. Add to date index (avoids KEYS * scan for usage stats)
    pipeline.sadd(dateIndexKey, usageKey);
    pipeline.expire(dateIndexKey, AI_USAGE_TTL);
    
    await pipeline.exec();
  } catch (error) {
    console.error('Error tracking AI usage:', error);
  }
}

// Admin functions
export async function getAllAIConversations(): Promise<AIConversation[]> {
  if (!redis) return [];

  try {
    // Use Set index instead of KEYS *
    let conversationKeys = await redis.smembers('ai:conversations:index');
    
    // Fallback to KEYS for migration if index empty
    if (conversationKeys.length === 0) {
      conversationKeys = await redis.keys('ai:conversations:*');
      // Filter out non-conversation keys (like indices)
      conversationKeys = conversationKeys.filter(k => k.split(':').length === 4); 
    }
    
    if (conversationKeys.length === 0) return [];

    // Fetch all conversations in batch
    // Batch MGET in chunks of 100 to avoid huge payloads
    const chunks = [];
    for (let i = 0; i < conversationKeys.length; i += 100) {
      chunks.push(conversationKeys.slice(i, i + 100));
    }

    const conversations: AIConversation[] = [];
    
    for (const chunk of chunks) {
      if (chunk.length === 0) continue;
      const dataArray = await redis.mget(...chunk);
      
      for (const data of dataArray) {
        if (data) {
          try {
            const conversation = typeof data === 'object' ? data : JSON.parse(data as string);
            conversations.push(conversation as AIConversation);
          } catch (e) {
            // skip bad data
          }
        }
      }
    }

    return conversations.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  } catch (error) {
    console.error('Error getting all conversations:', error);
    return [];
  }
}

export async function getAIUsageStats(): Promise<AIUsageStats> {
  if (!redis) {
    return {
      totalConversations: 0,
      totalMessages: 0,
      totalTokens: 0,
      dailyUsage: 0,
      costEstimate: 0,
    };
  }

  const conversations = await getAllAIConversations();
  const totalConversations = conversations.length;
  const totalMessages = conversations.reduce((sum, conv) => sum + conv.messageCount, 0);
  const totalTokens = conversations.reduce((sum, conv) => sum + conv.totalTokens, 0);

  const today = new Date().toISOString().split('T')[0];
  
  let dailyUsage = 0;
  try {
    // Try using the index
    const dateIndexKey = `ai:usage_index:${today}`;
    let usageKeys = await redis.smembers(dateIndexKey);
    
    // Fallback if index empty
    if (usageKeys.length === 0) {
      usageKeys = await redis.keys(`ai:usage:*:${today}`);
    }
    
    if (usageKeys.length > 0) {
      // Chunked MGET
      const chunks = [];
      for (let i = 0; i < usageKeys.length; i += 100) {
        chunks.push(usageKeys.slice(i, i + 100));
      }

      for (const chunk of chunks) {
        if (chunk.length === 0) continue;
        const dataArray = await redis.mget(...chunk);
        for (const data of dataArray) {
           if (data) {
             const usage = typeof data === 'object' ? data : JSON.parse(data as string);
             dailyUsage += usage.tokens || 0;
           }
        }
      }
    }
  } catch (error) {
    console.error('Error calculating daily usage:', error);
  }

  const config = getCurrentModelConfig();
  const costEstimate = totalTokens * config.costPerToken;

  return {
    totalConversations,
    totalMessages,
    totalTokens,
    dailyUsage,
    costEstimate,
  };
}

export async function deleteAIConversation(conversationId: string): Promise<boolean> {
  if (!redis) return false;

  try {
    const pipeline = redis.pipeline();
    
    // 1. Get all messages to delete (using list or scan)
    const listKey = `ai:conversation_messages:${conversationId}`;
    const messageKeys = await redis.lrange(listKey, 0, -1);
    
    if (messageKeys.length > 0) {
      pipeline.del(...messageKeys);
    }
    
    // Also clean up legacy keys if any remain
    const legacyKeys = await redis.keys(`ai:messages:${conversationId}:*`);
    if (legacyKeys.length > 0) {
      pipeline.del(...legacyKeys);
    }

    // 2. Delete conversation metadata
    const conversationKeys = await redis.keys(`ai:conversations:*:${conversationId}`);
    if (conversationKeys.length > 0) {
      pipeline.del(...conversationKeys);
      // Also remove from index
      pipeline.srem('ai:conversations:index', ...conversationKeys);
      
      for (const k of conversationKeys) {
          const parts = k.split(':');
          if (parts.length >= 3) {
             const address = parts[2];
             pipeline.del(`ai:user_active_conversation:${address}`);
          }
      }
    }
    
    // 3. Delete the message list
    pipeline.del(listKey);

    await pipeline.exec();
    return true;
  } catch (error) {
    console.error('Error deleting AI conversation:', error);
    return false;
  }
}
