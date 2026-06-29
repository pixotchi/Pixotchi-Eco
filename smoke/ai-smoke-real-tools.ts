import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, gateway, isStepCount, type GatewayModelId } from 'ai';
import { READ_ONLY_AGENT_SYSTEM_PROMPT } from '../lib/ai-context';
import { createReadOnlyAITools, createReadOnlyAIToolsContext, executeReadOnlyAITool } from '../lib/ai-read-tools';
import { classifyAIUserMessage } from '../lib/ai-safety';

const DEFAULT_TEST_ADDRESS = '0x000000000000000000000000000000000000dEaD';

function loadEnvFile(fileName: string) {
  const path = resolve(process.cwd(), fileName);
  if (!existsSync(path)) return;

  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

function selectGoogleSmokeModel(): string {
  return process.env.AI_SMOKE_MODEL || 'gemini-3.5-flash';
}

function createModel(provider: string, modelName: string) {
  if (provider === 'google') {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is required for Google smoke tests.');
    }
    return createGoogle({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })(modelName);
  }

  if (provider === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for OpenAI smoke tests.');
    }
    return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(modelName);
  }

  if (provider === 'anthropic' || provider === 'claude') {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required for Anthropic smoke tests.');
    }
    return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(modelName);
  }

  if (provider === 'gateway') {
    return gateway(modelName as GatewayModelId);
  }

  throw new Error(`Unsupported smoke provider: ${provider}`);
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractToolNames(result: UntypedValue): string[] {
  const calls = Array.isArray(result.toolCalls) && result.toolCalls.length > 0
    ? result.toolCalls
    : ((result.steps || []).flatMap((step: UntypedValue) => step.toolCalls || []));
  return calls.map((call: UntypedValue) => call.toolName);
}

function extractToolOutputs(result: UntypedValue) {
  const toolResults = Array.isArray(result.toolResults) && result.toolResults.length > 0
    ? result.toolResults
    : ((result.steps || []).flatMap((step: UntypedValue) => step.toolResults || []));
  return toolResults.map((toolResult: UntypedValue) => ({
    output: toolResult.output ?? toolResult.result,
    toolName: toolResult.toolName,
  }));
}

function shouldUseSingleRoundGeminiTools(provider: string, modelName: string): boolean {
  return provider === 'google' && /^gemini-3/i.test(modelName);
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const thoughtSignatureWarnings: string[] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const message = args.map((arg) => {
    if (typeof arg === 'string') return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(' ');

  if (/thoughtSignature|AI SDK Warning/i.test(message)) {
    thoughtSignatureWarnings.push(message);
  }

  originalWarn(...args);
};

async function main() {
const testAddress = process.env.AI_READONLY_TEST_ADDRESS || DEFAULT_TEST_ADDRESS;
const tools = createReadOnlyAITools();
const toolContext = { userAddress: testAddress };
const toolsContext = createReadOnlyAIToolsContext(toolContext, tools);
const runTool = (toolName: string, input: UntypedValue = {}) =>
  executeReadOnlyAITool(tools, toolName, input, toolContext);

const priceResult = await runTool('get_game_prices', {
  fenceDays: 1,
  includeGardenItems: true,
  includeShopItems: true,
});
const strains = priceResult?.data?.strains || [];
const tyj = strains.find((strain: UntypedValue) => String(strain.name).toUpperCase() === 'TYJ');
const seedStrains = strains.filter((strain: UntypedValue) => strain.priceTokenSymbol === 'SEED');

assert(tyj, 'TYJ strain missing from get_game_prices.');
assert(tyj.priceDisplay === '500 JESSE', `TYJ priceDisplay should be 500 JESSE, got ${tyj.priceDisplay}.`);
assert(tyj.mintPriceSeed == null, 'TYJ must not expose mintPriceSeed because it is paid in JESSE.');
assert(seedStrains.some((strain: UntypedValue) => strain.priceDisplay === '10 SEED'), 'Expected at least one SEED strain to render as 10 SEED.');

const deterministicToolOutputs = [
  {
    output: priceResult,
    toolName: 'get_game_prices',
  },
  {
    output: await runTool('get_mint_availability', {
      address: testAddress,
      includeLand: true,
      includePlants: true,
    }),
    toolName: 'get_mint_availability',
  },
  {
    output: await runTool('get_game_action_guide', {
      includeSafetyNotes: true,
      limit: 8,
      query: 'minting onboarding live prices',
    }),
    toolName: 'get_game_action_guide',
  },
];

const provider = process.env.AI_SMOKE_PROVIDER || 'google';
const modelName = provider === 'google'
  ? selectGoogleSmokeModel()
  : (process.env.AI_SMOKE_MODEL || process.env.AI_MODEL || (
    provider === 'openai'
      ? 'gpt-4.1-mini'
      : provider === 'gateway'
        ? 'openai/gpt-5-mini'
        : 'claude-haiku-4-5-20251001'
  ));
const model = createModel(provider, modelName);

const onboardingPrompt = [
  'Use the Pixotchi read-only tools to onboard this wallet.',
  'Call player overview, game prices, and the action guide for minting/onboarding.',
  'Mention TYJ only with its exact live priceDisplay.',
  `Wallet: ${testAddress}`,
].join(' ');

let onboardingResult: UntypedValue;
let toolNames: string[];

if (shouldUseSingleRoundGeminiTools(provider, modelName)) {
  const planningResult = await generateText({
    maxOutputTokens: 1024,
    messages: [
      {
        content: onboardingPrompt,
        role: 'user',
      },
    ],
    model,
    stopWhen: isStepCount(1),
    instructions: `${READ_ONLY_AGENT_SYSTEM_PROMPT}\n\nFor this tool-planning pass, call every needed read-only tool in a single round. Do not make sequential follow-up tool calls. Do not answer the user unless no tool is needed.`,
    tools,
    toolsContext,
  });
  const toolOutputs = [
    ...deterministicToolOutputs,
    ...extractToolOutputs(planningResult),
  ];
  toolNames = [
    ...deterministicToolOutputs.map((entry) => entry.toolName),
    ...extractToolNames(planningResult),
  ];

  onboardingResult = await generateText({
    maxOutputTokens: 2048,
    messages: [
      {
        content: onboardingPrompt,
        role: 'user',
      },
      {
        content: [
          'Sanitized read-only Pixotchi tool results for the current request:',
          JSON.stringify(toolOutputs, null, 2),
          'Now answer the user from these tool results. Quote priceDisplay exactly. Stay read-only and concise.',
        ].join('\n\n'),
        role: 'user',
      },
    ],
    model,
    instructions: READ_ONLY_AGENT_SYSTEM_PROMPT,
  });
} else {
  onboardingResult = await generateText({
    maxOutputTokens: 2048,
    messages: [
    {
      content: onboardingPrompt,
      role: 'user',
    },
    {
      content: [
        'Deterministic read-only Pixotchi tool results already fetched for this request:',
        JSON.stringify(deterministicToolOutputs, null, 2),
        'Use these results if the model does not call the same tools again. Quote priceDisplay exactly.',
      ].join('\n\n'),
      role: 'user',
    },
    ],
    model,
    stopWhen: isStepCount(8),
    instructions: READ_ONLY_AGENT_SYSTEM_PROMPT,
    tools,
    toolsContext,
  });
  toolNames = [
    ...deterministicToolOutputs.map((entry) => entry.toolName),
    ...extractToolNames(onboardingResult),
  ];
}

assert(toolNames.includes('get_game_prices'), 'Onboarding smoke did not call get_game_prices.');
assert(toolNames.some((name) => name === 'get_player_overview' || name === 'get_game_action_guide'), 'Onboarding smoke did not call an overview/action guide tool.');
assert(onboardingResult.finishReason !== 'length', 'Onboarding smoke response finished because of length.');
assert(!/TYJ[^.\n]*500\s+SEED|500\s+SEED[^.\n]*TYJ/i.test(onboardingResult.text), 'Onboarding smoke produced wrong TYJ token label.');

const transactionRequest = 'Prepare mint approval calldata and a transaction payload for me to mint TYJ.';
const safety = classifyAIUserMessage(transactionRequest);
if (safety.allowed) {
  throw new Error('Safety classifier should block calldata/transaction requests.');
}

assert(/cannot|calldata|transaction payload|execute/i.test(safety.response), 'Transaction/calldata request was not safely refused.');
assert(!/0x[a-fA-F0-9]{8,}/.test(safety.response), 'Refusal response should not provide calldata or transaction payload hex.');
assert(thoughtSignatureWarnings.length === 0, `AI SDK thought-signature warning(s) appeared:\n${thoughtSignatureWarnings.join('\n')}`);

console.log(JSON.stringify({
  finishReason: onboardingResult.finishReason,
  model: modelName,
  ok: true,
  provider,
  toolCalls: Array.from(new Set(toolNames)),
  tyjPriceDisplay: tyj.priceDisplay,
  usage: onboardingResult.usage,
}, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
