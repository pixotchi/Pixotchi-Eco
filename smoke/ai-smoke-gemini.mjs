import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGoogle } from '@ai-sdk/google';
import { generateText, isStepCount, tool } from 'ai';
import { z } from 'zod';

const DEFAULT_TEST_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const SEED_ADDRESS = '0x546D239032b24eCEEE0cb05c92FC39090846adc7';
const BALANCE_OF_SELECTOR = '70a08231';

function loadEnvFile(fileName) {
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

loadEnvFile('.env.local');
loadEnvFile('.env');

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  console.error('GOOGLE_GENERATIVE_AI_API_KEY is required for npm run ai:smoke:gemini.');
  process.exit(1);
}

const primaryRpcUrl = process.env.AI_BASE_RPC_URL || process.env.AI_RPC_URL || process.env.NEXT_PUBLIC_RPC_NODE;
const publicFallbackRpcUrl = process.env.AI_BASE_RPC_PUBLIC_FALLBACK_URL || process.env.AI_RPC_PUBLIC_FALLBACK_URL || 'https://mainnet.base.org';
const rpcUrls = Array.from(new Set([primaryRpcUrl, publicFallbackRpcUrl].filter(Boolean)));
const modelName = process.env.AI_SMOKE_MODEL || 'gemini-3.5-flash';
const testAddress = process.env.AI_READONLY_TEST_ADDRESS || DEFAULT_TEST_ADDRESS;
const thoughtSignatureWarnings = [];
const originalWarn = console.warn;

console.warn = (...args) => {
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

const google = createGoogle({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

function formatUnits(raw, decimals) {
  const value = BigInt(raw);
  const base = BigInt(10) ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  if (fraction === BigInt(0)) return whole.toString();
  const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fractionText}`;
}

async function rpcCall(method, params) {
  let lastError;

  for (const rpcUrl of rpcUrls) {
    try {
      const response = await fetch(rpcUrl, {
        body: JSON.stringify({
          id: Date.now(),
          jsonrpc: '2.0',
          method,
          params,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`RPC ${method} failed with HTTP ${response.status}`);
      }

      const json = await response.json();
      if (json.error) {
        throw new Error(json.error.message || `RPC ${method} returned an error`);
      }

      return {
        result: json.result,
        sourceLabel: rpcUrl === publicFallbackRpcUrl ? 'AI public fallback RPC' : 'AI primary RPC',
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`RPC ${method} failed before execution`);
}

function encodeBalanceOf(address) {
  const normalized = address.toLowerCase().replace(/^0x/, '');
  if (!/^[a-f0-9]{40}$/.test(normalized)) {
    throw new Error('AI_READONLY_TEST_ADDRESS must be a valid EVM address.');
  }
  return `0x${BALANCE_OF_SELECTOR}${normalized.padStart(64, '0')}`;
}

const readSeedBalance = tool({
  description: 'Read a SEED token balance on Base. Read-only smoke-test tool.',
  inputSchema: z.object({
    reason: z.string().describe('Why this read is needed.'),
  }),
  strict: true,
  execute: async () => {
    const [balance, blockNumber] = await Promise.all([
      rpcCall('eth_call', [{
        data: encodeBalanceOf(testAddress),
        to: SEED_ADDRESS,
      }, 'latest']),
      rpcCall('eth_blockNumber', []),
    ]);
    const balanceRaw = BigInt(balance.result || '0x0');

    return {
      address: testAddress,
      balanceRaw: balanceRaw.toString(),
      balanceSeed: formatUnits(balanceRaw, 18),
      blockNumber: BigInt(blockNumber.result || '0x0').toString(),
      source: `${balance.sourceLabel} ERC20 balanceOf`,
    };
  },
});

const result = await generateText({
  model: google(modelName),
  instructions: 'You are testing a read-only Pixotchi AI integration. Call the tool, then summarize the result in one sentence.',
  messages: [
    {
      role: 'user',
      content: `Read the test wallet SEED balance for ${testAddress}.`,
    },
  ],
  stopWhen: isStepCount(3),
  tools: {
    read_seed_balance: readSeedBalance,
  },
});

const stepToolCalls = (result.steps || []).flatMap((step) => step.toolCalls || []);
const stepToolResults = (result.steps || []).flatMap((step) => step.toolResults || []);
const toolCalls = Array.isArray(result.toolCalls) && result.toolCalls.length > 0
  ? result.toolCalls
  : stepToolCalls;
const toolResults = Array.isArray(result.toolResults) && result.toolResults.length > 0
  ? result.toolResults
  : stepToolResults;

if (toolResults.length === 0) {
  console.error('Gemini smoke test did not produce a read-only tool result.');
  process.exit(1);
}

if (thoughtSignatureWarnings.length > 0) {
  console.error(`Gemini smoke test emitted AI SDK warning(s):\n${thoughtSignatureWarnings.join('\n')}`);
  process.exit(1);
}

console.log(JSON.stringify({
  model: modelName,
  ok: true,
  text: result.text,
  toolCalls: toolCalls.map((call) => call.toolName),
  toolResults: toolResults.map((toolResult) => ({
    output: toolResult.output,
    toolName: toolResult.toolName,
  })),
  usage: result.usage,
}, null, 2));
