import { redis } from './redis';
import { nanoid } from 'nanoid';
import { AIChatMessage, AIConversation, AIUsageStats, AICostMetrics, AIProvider } from './types';
import { getCurrentAIProvider, getCurrentModelConfig, validateAIConfig } from './ai-config';
import { buildAIPrompt, generateConversationTitle } from './ai-context';
import { formatDisplayName } from './chat-service';
import { getUserGameStats, formatStatsForAI } from './user-stats-service';

const AI_MESSAGE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
const AI_RATE_LIMIT_TTL = 60 * 60; // 1 hour in seconds
const AI_USAGE_TTL = 24 * 60 * 60; // 24 hours in seconds

// Rate limiting configuration
const AI_RATE_LIMIT_WINDOW = 10; // 10 seconds between AI messages
const MAX_AI_MESSAGE_LENGTH = 300;
const MIN_AI_MESSAGE_LENGTH = 3;

// AI Provider Interface
type PromptData = 
  | string 
  | { system: string; userContent: string }
  | { systemBlocks?: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>; userContent: string };

interface IAIProvider {
  sendMessage(promptData: PromptData): Promise<{ response: string; tokensUsed: number }>;
  getModelName(): string;
}

// OpenAI Provider Implementation
class OpenAIProvider implements IAIProvider {
  private apiKey: string;
  private model: string;
  private maxTokens: number;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    const config = getCurrentModelConfig();
    this.model = config.model;
    this.maxTokens = config.maxTokens;
  }

  async sendMessage(promptData: PromptData): Promise<{ response: string; tokensUsed: number }> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Handle both new structured format and legacy string format
    let messages: any[];
    
    if (typeof promptData === 'string') {
      // Legacy format - treat entire prompt as user message
      messages = [{ role: 'user', content: promptData }];
    } else if ('systemBlocks' in promptData) {
      // For OpenAI, reconstruct system string from blocks (ignore cache_control)
      const systemText = promptData.systemBlocks?.map(block => block.text).join('\n\n') || '';
      messages = [
        { role: 'system', content: systemText },
        { role: 'user', content: promptData.userContent }
      ];
    } else {
      // New structured format - use system message for OpenAI
      messages = [
        { role: 'system', content: (promptData as any).system },
        { role: 'user', content: promptData.userContent }
      ];
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: this.maxTokens,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    
    return {
      response: data.choices[0]?.message?.content || 'Sorry, I could not generate a response.',
      tokensUsed: data.usage?.total_tokens || 0,
    };
  }

  getModelName(): string {
    return this.model;
  }
}

// Retry helper with exponential backoff
async function retryWithExponentialBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on non-retryable errors
      if (error.message?.includes('401') || error.message?.includes('403') || error.message?.includes('400')) {
        throw error;
      }
      
      // Check if it's a retryable error (429, 500, 502, 503, 504, 529)
      const isRetryable = error.message?.match(/\b(429|500|502|503|504|529)\b/);
      
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      
      // Calculate delay with exponential backoff and jitter
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      console.log(`🔄 Retrying Claude API call in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

// Claude Provider Implementation  
class ClaudeProvider implements IAIProvider {
  private apiKey: string;
  private model: string;
  private maxTokens: number;

  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
    const config = getCurrentModelConfig();
    this.model = config.model;
    this.maxTokens = config.maxTokens;
  }

  async sendMessage(promptData: PromptData): Promise<{ response: string; tokensUsed: number }> {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    // Handle both new structured format and legacy string format
    let requestBody: any;
    
    if (typeof promptData === 'string') {
      // Legacy format - treat entire prompt as user message
      requestBody = {
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [{ role: 'user', content: promptData }],
        temperature: 0.2, // ✅ Only temperature (Haiku 4.5 doesn't allow temperature + top_p)
      };
    } else if ('systemBlocks' in promptData && promptData.systemBlocks) {
      // New cached format with prompt caching enabled
      requestBody = {
        model: this.model,
        max_tokens: this.maxTokens,
        system: promptData.systemBlocks, // PROPER: Use system parameter with cache_control blocks
        messages: [{ role: 'user', content: promptData.userContent }], // PROPER: Only user content in messages
        temperature: 0.2, // ✅ Only temperature (Haiku 4.5 doesn't allow temperature + top_p)
      };
    } else {
      // Fallback structured format without caching
      requestBody = {
        model: this.model,
        max_tokens: this.maxTokens,
        system: (promptData as any).system, // Legacy system string
        messages: [{ role: 'user', content: promptData.userContent }],
        temperature: 0.2, // ✅ Only temperature (Haiku 4.5 doesn't allow temperature + top_p
      };
    }

    // Wrap the API call in retry logic
    const makeApiCall = async () => {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01', 
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Claude API Error:', {
          status: response.status,
          statusText: response.statusText,
          error: error,
          model: this.model,
          hasApiKey: !!this.apiKey
        });
        throw new Error(`Claude API error (${response.status}): ${error}`);
      }

      return response;
    };

    // Execute with retry logic
    const response = await retryWithExponentialBackoff(makeApiCall, 3, 1000);

    const data = await response.json();
    
    // Debug logging in development only
    if (process.env.NODE_ENV === 'development') {
      console.log('🔍 Claude API Response Debug (WITH PROMPT CACHING):', {
        hasContent: !!data.content,
        contentLength: data.content?.length,
        firstContentType: data.content?.[0]?.type,
        hasText: !!data.content?.[0]?.text,
        actualTextLength: data.content?.[0]?.text?.length,
        fullText: data.content?.[0]?.text,
        usage: data.usage,
        model: data.model,
        maxTokensRequested: this.maxTokens,
        stopReason: data.stop_reason,
        requestStructure: typeof promptData === 'string' ? 'LEGACY' : ('systemBlocks' in promptData ? 'CACHED_BLOCKS' : 'SYSTEM_PARAM'),
        cacheInfo: {
          cacheCreationTokens: data.usage?.cache_creation_input_tokens || 0,
          cacheReadTokens: data.usage?.cache_read_input_tokens || 0,
          regularInputTokens: data.usage?.input_tokens || 0,
          totalInputTokens: (data.usage?.cache_read_input_tokens || 0) + (data.usage?.cache_creation_input_tokens || 0) + (data.usage?.input_tokens || 0),
          cacheSavingsPercent: data.usage?.cache_read_input_tokens ? Math.round((data.usage.cache_read_input_tokens / ((data.usage?.cache_read_input_tokens || 0) + (data.usage?.cache_creation_input_tokens || 0) + (data.usage?.input_tokens || 0))) * 100) : 0
        }
      });
    }
    
    const responseText = data.content[0]?.text || 'Sorry, I could not generate a response.';
    
    // Log response length with cache metrics
    const cacheReadTokens = data.usage?.cache_read_input_tokens || 0;
    const cacheWriteTokens = data.usage?.cache_creation_input_tokens || 0;
    const regularTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;
    
    if (cacheReadTokens > 0) {
      console.log(`💾 Claude Response (CACHE HIT): ${responseText.length} chars | Cache hit: ${cacheReadTokens.toLocaleString()} tokens (90% savings!) | Write: ${cacheWriteTokens} | Regular: ${regularTokens} | Output: ${outputTokens}`);
    } else if (cacheWriteTokens > 0) {
      console.log(`💾 Claude Response (CACHE WRITE): ${responseText.length} chars | Writing to cache: ${cacheWriteTokens.toLocaleString()} tokens | Regular: ${regularTokens} | Output: ${outputTokens}`);
    } else {
      console.log(`🤖 Claude Response: ${responseText.length} characters, ${(data.usage?.output_tokens || 0)} tokens`);
    }
    
    // Check for unexpected stop reasons
    if (data.stop_reason && data.stop_reason !== 'end_turn' && data.stop_reason !== 'max_tokens') {
      console.warn(`⚠️ Claude stopped unexpectedly: ${data.stop_reason}`);
    }
    
    // If response seems incomplete, log it
    if (responseText.length < 50 || !responseText.includes('.')) {
      console.warn(`⚠️ Response seems incomplete:`, {
        length: responseText.length,
        stopReason: data.stop_reason,
        endsProperLy: responseText.endsWith('.') || responseText.endsWith('!') || responseText.endsWith('?'),
        preview: responseText
      });
    }
    
    return {
      response: responseText,
      tokensUsed: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    };
  }

  getModelName(): string {
    return this.model;
  }
}

// Factory function to create AI provider
function createAIProvider(): IAIProvider {
  const provider = getCurrentAIProvider();
  
  switch (provider) {
    case 'openai':
      return new OpenAIProvider();
    case 'claude':
      return new ClaudeProvider();
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
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
    console.warn('Redis unavailable - failing closed for rate limit');
    return false; // Fail closed if Redis is not available
  }

  try {
    const rateLimitKey = `ai:ratelimit:${address.toLowerCase()}`;
    const lastMessage = await redis.get(rateLimitKey);
    
    if (!lastMessage) return true;
    
    // Validate that lastMessage is a valid timestamp
    if (typeof lastMessage !== 'string' && typeof lastMessage !== 'number') {
      console.warn('Invalid rate limit data type');
      return false;
    }
    
    const now = Date.now();
    const lastMessageTime = parseInt(String(lastMessage), 10);
    if (isNaN(lastMessageTime)) {
      console.warn('Invalid rate limit timestamp');
      return false;
    }
    
    return (now - lastMessageTime) >= (AI_RATE_LIMIT_WINDOW * 1000);
  } catch (error) {
    console.error('Rate limit check failed:', error);
    return false; // Fail closed on error
  }
}

// Update AI rate limit for a user
export async function updateAIRateLimit(address: string): Promise<void> {
  if (!redis) {
    return; // Skip if Redis is not available
  }

  const rateLimitKey = `ai:ratelimit:${address.toLowerCase()}`;
  const now = Date.now();
  
  await redis.set(rateLimitKey, now.toString(), { ex: AI_RATE_LIMIT_TTL });
}

// Get or create conversation for user
export async function getOrCreateConversation(address: string, firstMessage?: string): Promise<string> {
  if (!redis) {
    throw new Error('Redis client not available');
  }

  // Check for existing active conversation
  const conversationKeys = await redis.keys(`ai:conversations:${address.toLowerCase()}:*`);
  
  if (conversationKeys.length > 0) {
    // Return the most recent conversation
    const conversationId = conversationKeys[0].split(':')[3];
    return conversationId;
  }

  // Create new conversation
  const conversationId = nanoid();
  const now = Date.now();
  
  const conversation: AIConversation = {
    id: conversationId,
    address: address.toLowerCase(),
    title: firstMessage ? generateConversationTitle(firstMessage) : 'New Conversation',
    createdAt: now,
    lastMessageAt: now,
    messageCount: 0,
    model: getCurrentModelConfig().model,
    totalTokens: 0,
  };

  const conversationKey = `ai:conversations:${address.toLowerCase()}:${conversationId}`;
  await redis.set(conversationKey, JSON.stringify(conversation), { ex: AI_MESSAGE_TTL });

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
  
  const aiMessage: AIChatMessage = {
    id: messageId,
    conversationId,
    address: address.toLowerCase(),
    message: message.trim(),
    timestamp,
    type,
    model: getCurrentModelConfig().model,
    tokensUsed,
    displayName: type === 'assistant' ? 'Neural Seed' : formatDisplayName(address)
  };

  // Store message
  const messageKey = `ai:messages:${conversationId}:${timestamp}:${messageId}`;
  await redis.set(messageKey, JSON.stringify(aiMessage), { ex: AI_MESSAGE_TTL });

  // Update conversation metadata
  const conversationKey = `ai:conversations:${address.toLowerCase()}:${conversationId}`;
  const conversationData = await redis.get(conversationKey);
  
  if (conversationData) {
    try {
      let conversation: AIConversation;
      if (typeof conversationData === 'object') {
        conversation = conversationData as AIConversation;
      } else {
        conversation = JSON.parse(conversationData as string);
      }
      
      conversation.lastMessageAt = timestamp;
      conversation.messageCount += 1;
      conversation.totalTokens += tokensUsed;
      
      await redis.set(conversationKey, JSON.stringify(conversation), { ex: AI_MESSAGE_TTL });
    } catch (error) {
      console.error('Error updating conversation metadata:', error);
    }
  }

  return aiMessage;
}

// Get conversation messages
export async function getAIConversationMessages(conversationId: string, limit: number = 50): Promise<AIChatMessage[]> {
  if (!redis) {
    return [];
  }

  const keys = await redis.keys(`ai:messages:${conversationId}:*`);
  
  if (keys.length === 0) return [];
  
  // Sort keys by timestamp (ascending)
  keys.sort((a, b) => {
    const timestampA = parseInt(a.split(':')[3]);
    const timestampB = parseInt(b.split(':')[3]);
    return timestampA - timestampB;
  });

  const recentKeys = keys.slice(-limit);
  const messages: AIChatMessage[] = [];
  
  for (const key of recentKeys) {
    try {
      const data = await redis.get(key);
      if (data) {
        let message: AIChatMessage;
        if (typeof data === 'object') {
          message = data as AIChatMessage;
        } else {
          message = JSON.parse(data as string);
        }
        messages.push(message);
      }
    } catch (error) {
      console.error('Error parsing AI message:', error);
    }
  }

  return messages;
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
    // Log prompt details with caching strategy
    const promptInfo = typeof promptData === 'string'
      ? {
          format: 'LEGACY_STRING',
          cacheStrategy: 'DISABLED - Legacy string format'
        }
      : 'systemBlocks' in promptData 
      ? {
          systemBlocksCount: promptData.systemBlocks?.length || 0,
          staticContextLength: promptData.systemBlocks?.reduce((sum, block) => sum + block.text.length, 0) || 0,
          hasCacheControl: promptData.systemBlocks?.some(block => !!block.cache_control) || false,
          userContentLength: promptData.userContent.length,
          hasUserStats: !!userStats,
          userStatsLength: userStats?.length || 0,
          cacheStrategy: 'ENABLED - Static context (system + knowledge) cached, dynamic content (stats + history) uncached'
        }
      : {
          systemLength: (promptData as any).system?.length || 0,
          userContentLength: (promptData as any).userContent?.length || 0,
          hasUserStats: !!userStats,
          userStatsLength: userStats?.length || 0,
          cacheStrategy: 'DISABLED - Standard system format'
        };
    
    console.log('📝 AI Prompt Info (WITH CACHING STRATEGY):', {
      ...promptInfo,
      messageLength: message.length,
      hasHistory: !!conversationHistory,
      provider: getCurrentAIProvider(),
      model: getCurrentModelConfig().model,
      maxTokens: getCurrentModelConfig().maxTokens,
      estimatedCacheSavings: 'First request writes ~2500 tokens to cache; subsequent requests read from cache at 90% savings'
    });

    // Get AI response using new structured format
    const provider = createAIProvider();
    const { response, tokensUsed } = await provider.sendMessage(promptData);

    console.log('✅ AI Response Received:', {
      responseLength: response.length,
      tokensUsed,
      responsePreview: response.substring(0, 100) + (response.length > 100 ? '...' : ''),
      responseEnd: response.length > 100 ? response.substring(response.length - 50) : ''
    });

    // Store AI response
    const aiResponse = await storeAIMessage(address, response, 'assistant', conversationId, tokensUsed);

    console.log('💾 AI Response Stored:', {
      messageId: aiResponse.id,
      storedLength: aiResponse.message.length,
      matches: aiResponse.message === response
    });

    // Track usage
    await trackAIUsage(address, tokensUsed);

    return { userMessage, aiResponse };
  } catch (error) {
    console.error('AI Provider Error:', {
      provider: getCurrentAIProvider(),
      model: getCurrentModelConfig().model,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      address: address.slice(0, 6) + '...' // Privacy-safe logging
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
  
  try {
    const currentUsage = await redis.get(usageKey);
    let totalTokens = tokensUsed;
    
    if (currentUsage) {
      const usage = typeof currentUsage === 'object' ? currentUsage : JSON.parse(currentUsage as string);
      totalTokens += usage.tokens || 0;
    }
    
    await redis.set(usageKey, JSON.stringify({
      date: today,
      tokens: totalTokens,
      messages: 1,
    }), { ex: AI_USAGE_TTL });
  } catch (error) {
    console.error('Error tracking AI usage:', error);
  }
}

// Admin functions
export async function getAllAIConversations(): Promise<AIConversation[]> {
  if (!redis) return [];

  const keys = await redis.keys('ai:conversations:*');
  const conversations: AIConversation[] = [];
  
  for (const key of keys) {
    try {
      const data = await redis.get(key);
      if (data) {
        let conversation: AIConversation;
        if (typeof data === 'object') {
          conversation = data as AIConversation;
        } else {
          conversation = JSON.parse(data as string);
        }
        conversations.push(conversation);
      }
    } catch (error) {
      console.error('Error parsing AI conversation:', error);
    }
  }

  return conversations.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
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
  const usageKeys = await redis.keys(`ai:usage:*:${today}`);
  let dailyUsage = 0;
  
  for (const key of usageKeys) {
    try {
      const data = await redis.get(key);
      if (data) {
        const usage = typeof data === 'object' ? data : JSON.parse(data as string);
        dailyUsage += usage.tokens || 0;
      }
    } catch (error) {
      console.error('Error calculating daily usage:', error);
    }
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
    // Delete all messages in conversation
    const messageKeys = await redis.keys(`ai:messages:${conversationId}:*`);
    if (messageKeys.length > 0) {
      await redis.del(...messageKeys);
    }

    // Delete conversation metadata
    const conversationKeys = await redis.keys(`ai:conversations:*:${conversationId}`);
    if (conversationKeys.length > 0) {
      await redis.del(...conversationKeys);
    }

    return true;
  } catch (error) {
    console.error('Error deleting AI conversation:', error);
    return false;
  }
}