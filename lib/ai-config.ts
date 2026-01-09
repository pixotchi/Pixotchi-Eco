import { AIProvider } from './types';

export const AI_CONFIG = {
  providers: {
    openai: {
      models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
      defaultModel: 'gpt-4o-mini',
      maxTokens: 300,
      costPerToken: 0.00015 / 1000, // Approximate cost per token
      endpoint: 'https://api.openai.com/v1/chat/completions',
    },
    claude: {
      models: [
        'claude-3-haiku-20240307',
        'claude-3-sonnet-20240229',
        'claude-3-5-sonnet-20240620',
        'claude-3-5-haiku-20241022',
        'claude-haiku-4-5-20251001'
      ],
      defaultModel: 'claude-3-5-haiku-20241022', // ✅ Changed to Haiku 4.5 (was Sonnet 4)
      maxTokens: 1024, // ✅ Increased from 600 (Haiku has 200k context window)
      costPerToken: 1 / 1_000_000, // ✅ Haiku 4.5: $1 per million input tokens
      // Prompt caching pricing:
      // - Cache writes (5-min): $1.25 / MTok (1.25x)
      // - Cache reads: $0.10 / MTok (90% savings!)
      // - Output tokens: $5 / MTok
      endpoint: 'https://api.anthropic.com/v1/messages',
    },
    google: {
      models: [
        'gemini-3-flash-preview',
        'gemini-1.5-pro',
        'gemini-2.0-flash'
      ],
      defaultModel: 'gemini-3-flash-preview',
      maxTokens: 2048,
      costPerToken: 0.35 / 1_000_000, // Gemini 1.5 Flash is very cheap
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    }
  },
  rateLimits: {
    messagesPerHour: 20,
    tokensPerDay: 2000,
    conversationsPerDay: 10,
  },
  timeouts: {
    requestTimeout: 30000, // 30 seconds
    responseTimeout: 45000, // 45 seconds
  }
};

// Get current AI provider from environment
export function getCurrentAIProvider(): AIProvider {
  const provider = process.env.AI_PROVIDER;

  // Handle both 'claude' and 'anthropic' as valid values for Claude
  if (provider === 'claude' || provider === 'anthropic') {
    return 'claude';
  }

  if (provider === 'openai') {
    return 'openai';
  }

  if (provider === 'google') {
    return 'google';
  }

  // Default fallback
  return 'openai';
}

// Get current model configuration
export function getCurrentModelConfig() {
  const provider = getCurrentAIProvider();
  const config = AI_CONFIG.providers[provider];
  const model = process.env.AI_MODEL || config.defaultModel;

  return {
    provider,
    model,
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '') || config.maxTokens,
    costPerToken: config.costPerToken,
    endpoint: config.endpoint
  };
}

export function getAgentAIProvider(): AIProvider {
  const provider = process.env.AGENT_AI_PROVIDER;
  if (provider === 'claude' || provider === 'anthropic') {
    return 'claude';
  }
  if (provider === 'openai') {
    return 'openai';
  }
  if (provider === 'google') {
    return 'google';
  }
  return getCurrentAIProvider();
}

export function getAgentModelConfig() {
  const provider = getAgentAIProvider();
  const config = AI_CONFIG.providers[provider];
  const model = process.env.AGENT_AI_MODEL || config.defaultModel;

  return {
    provider,
    model,
    maxTokens: parseInt(process.env.AGENT_AI_MAX_TOKENS || '') || config.maxTokens,
    costPerToken: config.costPerToken,
    endpoint: config.endpoint,
  };
}

// Validate environment variables
export function validateAIConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const provider = getCurrentAIProvider();

  if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
    errors.push('OPENAI_API_KEY is required when using OpenAI provider');
  }

  if (provider === 'claude' && !process.env.ANTHROPIC_API_KEY) {
    errors.push('ANTHROPIC_API_KEY is required when using Claude provider');
  }

  if (provider === 'google' && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    errors.push('GOOGLE_GENERATIVE_AI_API_KEY is required when using Google provider');
  }

  const model = process.env.AI_MODEL;
  if (model) {
    const config = AI_CONFIG.providers[provider];
    const isValidModel = config.models.includes(model) ||
      (provider === 'openai' && model.startsWith('gpt-')) ||
      (provider === 'claude' && model.startsWith('claude-')) ||
      (provider === 'google' && model.startsWith('gemini-'));

    if (!isValidModel) {
      errors.push(`Invalid model ${model} for provider ${provider}. Expected models starting with ${provider === 'openai' ? 'gpt-' : provider === 'claude' ? 'claude-' : 'gemini-'}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}