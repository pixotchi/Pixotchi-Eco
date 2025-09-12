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
        'claude-sonnet-4-20250514'
      ],
      defaultModel: 'claude-sonnet-4-20250514',
      maxTokens: 600,
      costPerToken: 0.00025 / 1000, // Approximate cost per token
      endpoint: 'https://api.anthropic.com/v1/messages',
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
  
  const model = process.env.AI_MODEL;
  if (model) {
    const config = AI_CONFIG.providers[provider];
    const isValidModel = config.models.includes(model) || 
                        (provider === 'openai' && model.startsWith('gpt-')) ||
                        (provider === 'claude' && model.startsWith('claude-'));
    
    if (!isValidModel) {
      errors.push(`Invalid model ${model} for provider ${provider}. Expected models starting with ${provider === 'openai' ? 'gpt-' : 'claude-'}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}