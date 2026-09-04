import assert from 'node:assert/strict';
import {
  AI_CONFIG,
  getCurrentAIProvider,
  getCurrentModelConfig,
  validateAIConfig,
} from '../lib/ai-config';

const ENV_KEYS = [
  'AI_PROVIDER',
  'AI_MODEL',
  'AI_FALLBACK_MODELS',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'AI_GATEWAY_API_KEY',
  'VERCEL_OIDC_TOKEN',
  'VERCEL',
] as const;

function withEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>, callback: () => void) {
  const saved = new Map<string, string | undefined>(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );

  try {
    for (const key of ENV_KEYS) {
      const value = overrides[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    callback();
  } finally {
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function assertInvalid(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>, message: RegExp) {
  withEnv(overrides, () => {
    const result = validateAIConfig();
    assert.equal(result.valid, false, `Expected invalid config: ${JSON.stringify(overrides)}`);
    assert.match(result.errors.join('\n'), message);
  });
}

function main() {
  assert(!AI_CONFIG.providers.claude.models.some((model) => model.startsWith('claude-3')));
  assert(!AI_CONFIG.providers.google.models.includes('gemini-1.5-pro'));
  assert(!AI_CONFIG.providers.google.models.includes('gemini-2.0-flash'));

  withEnv({
    AI_PROVIDER: 'anthropic',
    AI_MODEL: 'claude-sonnet-4-6',
    ANTHROPIC_API_KEY: 'test-key',
  }, () => {
    assert.equal(getCurrentAIProvider(), 'claude');
    assert.equal(getCurrentModelConfig().model, 'claude-sonnet-4-6');
    assert.deepEqual(validateAIConfig(), { valid: true, errors: [] });
  });

  withEnv({
    AI_PROVIDER: 'gateway',
    AI_MODEL: 'openai/gpt-5.4',
    AI_FALLBACK_MODELS: 'anthropic/claude-sonnet-4.6,google/gemini-3.6-flash',
    AI_GATEWAY_API_KEY: 'test-key',
  }, () => {
    assert.deepEqual(validateAIConfig(), { valid: true, errors: [] });
  });

  withEnv({
    AI_PROVIDER: 'gateway',
    AI_MODEL: 'openai/gpt-5-mini',
    AI_FALLBACK_MODELS: 'anthropic/claude-sonnet-4.5,google/gemini-3.5-flash',
    AI_GATEWAY_API_KEY: 'test-key',
  }, () => {
    assert.deepEqual(validateAIConfig(), { valid: true, errors: [] });
  });

  assertInvalid({
    AI_PROVIDER: 'claude',
    AI_MODEL: 'claude-3-haiku-20240307',
    ANTHROPIC_API_KEY: 'test-key',
  }, /Unsupported AI_MODEL claude-3-haiku-20240307/);
  assertInvalid({
    AI_PROVIDER: 'google',
    AI_MODEL: 'gemini-2.0-flash',
    GOOGLE_GENERATIVE_AI_API_KEY: 'test-key',
  }, /Unsupported AI_MODEL gemini-2\.0-flash/);
  assertInvalid({
    AI_PROVIDER: 'google',
    AI_MODEL: 'gemini-unreleased',
    GOOGLE_GENERATIVE_AI_API_KEY: 'test-key',
  }, /Unsupported AI_MODEL gemini-unreleased/);
  assertInvalid({
    AI_PROVIDER: 'gateway',
    AI_MODEL: 'openai/not-a-real-model',
    AI_FALLBACK_MODELS: 'google/not-a-real-model',
    AI_GATEWAY_API_KEY: 'test-key',
  }, /Unsupported AI_(MODEL|FALLBACK_MODELS entry)/);
  assertInvalid({
    AI_PROVIDER: 'unknown-provider',
    OPENAI_API_KEY: 'test-key',
  }, /Unsupported AI_PROVIDER unknown-provider/);

  console.log('AI model configuration hardening smoke passed.');
}

main();
