import { AIProvider } from './types';

const AI_PROVIDER_ALIASES = ['openai', 'claude', 'anthropic', 'google', 'gateway'] as const;

export const AI_CONFIG = {
  providers: {
    openai: {
      // Current API model IDs verified 2026-09-04. Keep the established GPT-4
      // entries for existing deployments while offering current GPT-5 models.
      models: ['gpt-5.6-luna', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o'],
      defaultModel: 'gpt-4.1-mini',
      maxTokens: 4096,
      costPerToken: 0.00015 / 1000, // Provider-wide estimate; model pricing varies
      endpoint: 'https://api.openai.com/v1/chat/completions',
    },
    claude: {
      models: [
        'claude-sonnet-4-6',
        'claude-opus-4-6',
        'claude-haiku-4-5-20251001',
      ],
      defaultModel: 'claude-sonnet-4-6',
      maxTokens: 4096,
      costPerToken: 1 / 1_000_000,
      // Prompt caching pricing:
      // - Cache writes (5-min): $1.25 / MTok (1.25x)
      // - Cache reads: $0.10 / MTok (90% savings!)
      // - Output tokens: $5 / MTok
      endpoint: 'https://api.anthropic.com/v1/messages',
    },
    google: {
      models: [
        'gemini-3.8-flash',
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
        'gemini-2.5-flash',
      ],
      defaultModel: 'gemini-3.5-flash',
      maxTokens: 4096,
      costPerToken: 0.35 / 1_000_000, // Provider-wide estimate; model pricing varies
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    },
    gateway: {
      // Gateway IDs are exact provider/model pairs, not a permissive prefix.
      // They were verified against https://ai-gateway.vercel.sh/v1/models on 2026-09-04.
      models: [
        'openai/gpt-5.6-luna',
        'openai/gpt-5.4',
        'openai/gpt-5.4-mini',
        'openai/gpt-5-mini',
        'anthropic/claude-sonnet-4.6',
        'anthropic/claude-sonnet-4.5',
        'anthropic/claude-haiku-4.5',
        'google/gemini-3.6-flash',
        'google/gemini-3.5-flash',
        'google/gemini-3.5-flash-lite',
        'google/gemini-2.5-flash',
      ],
      defaultModel: 'openai/gpt-5.4',
      maxTokens: 4096,
      costPerToken: 0,
      endpoint: 'https://ai-gateway.vercel.sh/v3/ai',
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
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase();

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

  if (provider === 'gateway') {
    return 'gateway';
  }

  // Default fallback
  return 'openai';
}

// Get current model configuration
export function getCurrentModelConfig() {
  const provider = getCurrentAIProvider();
  const config = AI_CONFIG.providers[provider];
  const model = process.env.AI_MODEL?.trim() || config.defaultModel;

  return {
    provider,
    model,
    fallbackModels: getConfiguredFallbackModels(),
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || '') || config.maxTokens,
    costPerToken: config.costPerToken,
    endpoint: config.endpoint
  };
}

function getConfiguredFallbackModels(): string[] {
  return (process.env.AI_FALLBACK_MODELS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isConfiguredModelAllowed(provider: AIProvider, model: string): boolean {
  return AI_CONFIG.providers[provider].models.includes(model);
}

// Validate environment variables
export function validateAIConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const provider = getCurrentAIProvider();
  const configuredProvider = process.env.AI_PROVIDER?.trim().toLowerCase();

  if (configuredProvider && !AI_PROVIDER_ALIASES.includes(configuredProvider as typeof AI_PROVIDER_ALIASES[number])) {
    errors.push(`Unsupported AI_PROVIDER ${process.env.AI_PROVIDER}.`);
  }

  if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
    errors.push('OPENAI_API_KEY is required when using OpenAI provider');
  }

  if (provider === 'claude' && !process.env.ANTHROPIC_API_KEY) {
    errors.push('ANTHROPIC_API_KEY is required when using Claude provider');
  }

  if (provider === 'google' && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    errors.push('GOOGLE_GENERATIVE_AI_API_KEY is required when using Google provider');
  }

  if (
    provider === 'gateway' &&
    !process.env.AI_GATEWAY_API_KEY &&
    !process.env.VERCEL_OIDC_TOKEN &&
    process.env.VERCEL !== '1'
  ) {
    errors.push('AI_GATEWAY_API_KEY, VERCEL_OIDC_TOKEN, or Vercel runtime OIDC is required when using AI Gateway provider');
  }

  const model = process.env.AI_MODEL?.trim();
  if (model && !isConfiguredModelAllowed(provider, model)) {
    errors.push(`Unsupported AI_MODEL ${model} for provider ${provider}. Use a model listed in AI_CONFIG.providers.${provider}.models.`);
  }

  for (const fallbackModel of getConfiguredFallbackModels()) {
    if (!isConfiguredModelAllowed(provider, fallbackModel)) {
      errors.push(`Unsupported AI_FALLBACK_MODELS entry ${fallbackModel} for provider ${provider}. Use a model listed in AI_CONFIG.providers.${provider}.models.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
