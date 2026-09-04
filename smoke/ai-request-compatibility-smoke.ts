import assert from 'node:assert/strict';

type AIServiceModule = typeof import('../lib/ai-service');

const ENV_KEYS = [
  'AI_FALLBACK_MODELS',
  'AI_GOOGLE_THINKING_BUDGET',
  'AI_GOOGLE_THINKING_LEVEL',
  'AI_MODEL',
  'AI_PROVIDER',
  'AI_TEMPERATURE',
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function configure(provider: string, model: string, fallbacks: string[] = []) {
  process.env.AI_PROVIDER = provider;
  process.env.AI_MODEL = model;
  process.env.AI_FALLBACK_MODELS = fallbacks.join(',');
}

function assertCachedSystemMessage(
  value: ReturnType<AIServiceModule['buildAIInstructions']>,
  expectedContent: string,
) {
  assert.notEqual(typeof value, 'string');
  if (typeof value === 'string') {
    throw new Error('Expected a provider-aware system message.');
  }

  assert.deepEqual(value, {
    content: expectedContent,
    providerOptions: {
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
    },
    role: 'system',
  });
}

async function main() {
  process.env.AI_TEMPERATURE = '0.37';
  process.env.AI_GOOGLE_THINKING_LEVEL = 'high';
  delete process.env.AI_GOOGLE_THINKING_BUDGET;

  const { buildAIInstructions, getModelRequestSettings } = await import('../lib/ai-service');

  configure('openai', 'gpt-4.1-mini');
  assert.deepEqual(getModelRequestSettings(), { temperature: 0.37 });
  assert.equal(buildAIInstructions('stable prompt'), 'stable prompt');

  configure('openai', 'gpt-5.4');
  assert.deepEqual(getModelRequestSettings(), { reasoning: 'high' });

  configure('claude', 'claude-sonnet-4-6');
  assert.deepEqual(getModelRequestSettings(), { reasoning: 'high' });
  assertCachedSystemMessage(buildAIInstructions('cache me'), 'cache me');

  configure('google', 'gemini-3.5-flash');
  assert.deepEqual(getModelRequestSettings(), { reasoning: 'high' });
  assert.equal(buildAIInstructions('stable prompt'), 'stable prompt');

  configure('google', 'gemini-2.5-flash');
  assert.deepEqual(getModelRequestSettings(), { reasoning: 'high', temperature: 0.37 });

  configure('gateway', 'openai/gpt-5.4', [
    'anthropic/claude-sonnet-4.6',
    'google/gemini-3.5-flash',
  ]);
  assert.deepEqual(getModelRequestSettings(), { reasoning: 'high' });
  assertCachedSystemMessage(buildAIInstructions('gateway cache'), 'gateway cache');

  configure('gateway', 'google/gemini-2.5-flash');
  assert.deepEqual(getModelRequestSettings(), { reasoning: 'high', temperature: 0.37 });
  assert.equal(buildAIInstructions('stable prompt'), 'stable prompt');

  configure('gateway', 'google/gemini-2.5-flash', ['openai/gpt-5.4']);
  assert.deepEqual(getModelRequestSettings(), { reasoning: 'high' });

  console.log('AI request compatibility smoke test passed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
