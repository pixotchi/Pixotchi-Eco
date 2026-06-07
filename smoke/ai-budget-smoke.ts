import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const DEFAULT_TEST_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const DEFAULT_GATEWAY_MODEL = 'openai/gpt-5-mini';
const DEFAULT_GATEWAY_FALLBACK_MODELS = 'anthropic/claude-sonnet-4.5,google/gemini-3.5-flash';

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

function applyBudgetSmokeDefaults() {
  process.env.AI_MAX_TOKENS = process.env.AI_BUDGET_SMOKE_MAX_TOKENS || '4096';
  process.env.AI_MAX_TOKENS_PER_DAY = process.env.AI_BUDGET_SMOKE_MAX_TOKENS_PER_DAY || '1000000';
  process.env.AI_AUTO_CONTINUE_ON_LENGTH = 'true';
  process.env.AI_PLANNING_MAX_OUTPUT_TOKENS = process.env.AI_PLANNING_MAX_OUTPUT_TOKENS || '1024';
  process.env.AI_CONTINUATION_MAX_OUTPUT_TOKENS = process.env.AI_CONTINUATION_MAX_OUTPUT_TOKENS || '2048';
  process.env.AI_GOOGLE_THINKING_LEVEL = process.env.AI_GOOGLE_THINKING_LEVEL || 'high';
  process.env.AI_GOOGLE_THINKING_BUDGET = process.env.AI_GOOGLE_THINKING_BUDGET || '0';
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function truthyEnv(value: string | undefined) {
  return /^(1|true|yes)$/i.test(value || '');
}

async function verifyGatewayModelChain() {
  const provider = (process.env.AI_PROVIDER || '').toLowerCase();
  const shouldValidate = provider === 'gateway' || truthyEnv(process.env.AI_BUDGET_SMOKE_VALIDATE_GATEWAY);

  if (!shouldValidate) {
    return {
      skipped: true,
      reason: 'AI_PROVIDER is not gateway',
    };
  }

  const primaryModel = process.env.AI_MODEL || DEFAULT_GATEWAY_MODEL;
  const fallbackModels = (process.env.AI_FALLBACK_MODELS || DEFAULT_GATEWAY_FALLBACK_MODELS)
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  const modelChain = [primaryModel, ...fallbackModels].filter((model, index, models) => models.indexOf(model) === index);
  const { gateway } = await import('ai');

  try {
    const availableModelsResult = await gateway.getAvailableModels();
    const models = Array.isArray(availableModelsResult)
      ? availableModelsResult
      : availableModelsResult.models;
    const availableIds = new Set(models.map((model: UntypedValue) => model.id));
    const availability = modelChain.map((model) => ({
      available: availableIds.has(model),
      model,
    }));
    const missing = availability.filter((entry) => !entry.available);

    assert(
      missing.length === 0,
      `Gateway model chain unavailable: ${missing.map((entry) => entry.model).join(', ')}`,
    );

    return {
      availability,
      skipped: false,
    };
  } catch (error) {
    throw new Error(`Gateway model chain check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runForcedLengthChild(testAddress: string) {
  const childScript = `
import { existsSync, readFileSync } from 'node:fs';
for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const rawLine of readFileSync(file, 'utf8').split(/\\r?\\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] == null) process.env[key] = value;
  }
}
process.env.AI_MAX_TOKENS = '96';
process.env.AI_MAX_TOKENS_PER_DAY = '1000000';
process.env.AI_AUTO_CONTINUE_ON_LENGTH = 'true';
process.env.AI_CONTINUATION_MAX_OUTPUT_TOKENS = '1024';
process.env.AI_GOOGLE_THINKING_LEVEL = process.env.AI_GOOGLE_THINKING_LEVEL || 'high';
process.env.AI_GOOGLE_THINKING_BUDGET = process.env.AI_GOOGLE_THINKING_BUDGET || '0';
const serviceImport = await import('./lib/ai-service.ts');
const service = serviceImport.default ?? serviceImport;
const result = await service.sendAIMessage(
  '${testAddress}',
  'Give me a detailed onboarding plan for Pixotchi using my wallet, live prices, plant care, land, staking, swap, quests, and the safest next action.'
);
await service.deleteAIConversation(result.userMessage.conversationId);
const output = {
  continuations: result.aiResponse.continuations || 0,
  finishReason: result.aiResponse.finishReason,
  message: result.aiResponse.message,
  recoveredFromLength: Boolean(result.aiResponse.recoveredFromLength),
};
console.log(JSON.stringify(output));
`;

  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_OPTIONS: process.env.NODE_OPTIONS || '--conditions=react-server',
        NODE_PATH: process.env.NODE_PATH || './node_modules/next/dist/compiled',
      },
      input: childScript,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  if (result.status !== 0) {
    throw new Error(`Forced low-cap child smoke failed:\n${result.stderr || result.stdout}`);
  }

  const lastLine = result.stdout.trim().split(/\r?\n/).pop() || '{}';
  const parsed = JSON.parse(lastLine);
  assert(parsed.continuations >= 1, 'Forced low-cap smoke did not trigger automatic continuation.');
  assert(!String(parsed.message).includes('I hit my response limit; ask me to continue'), 'Forced low-cap smoke exposed the raw truncation notice.');
  assert(/Farm|Mint|next/i.test(parsed.message), 'Forced low-cap smoke did not return a useful gameplay next step.');

  return parsed;
}

async function main() {
  loadEnvFile('.env.local');
  loadEnvFile('.env');
  applyBudgetSmokeDefaults();

  const gatewayModelCheck = await verifyGatewayModelChain();
  const testAddress = process.env.AI_READONLY_TEST_ADDRESS || DEFAULT_TEST_ADDRESS;
  const serviceImport = await import('../lib/ai-service');
  const safetyImport = await import('../lib/ai-safety');
  const toolsImport = await import('../lib/ai-read-tools');

  const tools = toolsImport.createReadOnlyAITools({ userAddress: testAddress });
  const priceResult = await (tools.get_game_prices as UntypedValue).execute({
    fenceDays: 1,
    includeGardenItems: true,
    includeShopItems: true,
  });
  const tyj = priceResult?.data?.strains?.find((strain: UntypedValue) => String(strain.name).toUpperCase() === 'TYJ');
  assert(tyj?.priceDisplay === '500 JESSE', `TYJ priceDisplay should be 500 JESSE, got ${tyj?.priceDisplay}.`);

  const normalResult = await serviceImport.sendAIMessage(
    testAddress,
    'I am new to Pixotchi. Read my wallet overview and current live prices, then tell me my next safe step.',
  );
  await serviceImport.deleteAIConversation(normalResult.userMessage.conversationId);
  assert(normalResult.aiResponse.finishReason !== 'length', 'Normal onboarding smoke finished with length.');
  assert(!normalResult.aiResponse.message.includes('I hit my response limit; ask me to continue'), 'Normal onboarding exposed the raw truncation notice.');
  assert(/Farm|Mint|next/i.test(normalResult.aiResponse.message), 'Normal onboarding did not include a useful next step.');

  const refusal = safetyImport.classifyAIUserMessage('Prepare mint approval calldata and a transaction payload for TYJ.');
  assert(!refusal.allowed, 'Transaction/calldata request was not refused before model execution.');
  if (refusal.allowed) {
    throw new Error('Transaction/calldata request unexpectedly passed safety.');
  }
  assert(/calldata|transaction/i.test(refusal.response), 'Transaction refusal did not explain the safe boundary.');
  assert(!/0x[a-fA-F0-9]{8,}/.test(refusal.response), 'Transaction refusal included calldata-like hex.');

  const forced = runForcedLengthChild(testAddress);

  console.log(JSON.stringify({
    forcedContinuation: forced.continuations,
	    forcedFinishReason: forced.finishReason,
	    forcedRecoveredFromLength: forced.recoveredFromLength,
	    gatewayModelCheck,
	    normalFinishReason: normalResult.aiResponse.finishReason,
	    ok: true,
    provider: process.env.AI_PROVIDER || 'openai',
    tyjPriceDisplay: tyj.priceDisplay,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
