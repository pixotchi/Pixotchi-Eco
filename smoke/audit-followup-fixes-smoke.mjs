// Offline. No dotenv, live RPC, paid AI calls, or real notification delivery.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Redis } from '@upstash/redis';
import { createRequire } from 'node:module';
import { generateText, streamText, wrapLanguageModel, isStepCount, tool } from 'ai';
import { z } from 'zod';
import { loadSource } from './helpers/load-source.mjs';
const { ContractFunctionRevertedError } = createRequire(import.meta.url)('viem');

const noNetwork = async () => { throw new Error('External requests are forbidden by this smoke test'); };
globalThis.fetch = noNetwork;
const address = `0x${'1'.repeat(40)}`;
const other = `0x${'2'.repeat(40)}`;
let passed = 0;
async function test(name, work) {
  await work();
  passed++;
  console.log(`PASS ${name}`);
}

await test('F01: staking admission charges work, stops provider reads, and fails closed', async () => {
  let unavailable = false;
  const counters = new Map();
  const limiter = await loadSource('lib/public-read-limit.ts', {
    './redis': { redisIncrementWithExpiry: async (key, cost) => {
      if (unavailable) return null;
      counters.set(key, (counters.get(key) ?? 0) + cost);
      return counters.get(key);
    } },
  });
  let reads = 0;
  const contracts = {
    getStakeComposite: async () => { reads++; return { stake: { staked: 0n, rewards: 0n }, allowance: 0n, approved: false, timeUnit: 1n, totalStaked: 0n }; },
    getTokenBalance: async () => { reads++; return 3n; },
  };
  const mocks = { '@/lib/public-read-limit': limiter, '@/lib/contracts': contracts };
  const info = await loadSource('app/api/staking/info/route.ts', mocks);
  const balance = await loadSource('app/api/staking/balance/route.ts', mocks);
  const request = route => new Request(`http://localhost/api/staking/${route}?address=${address}`, { headers: { 'x-forwarded-for': '127.0.0.1' } });
  for (let n = 0; n < 60; n++) assert.equal((await info.GET(request('info'))).status, 200);
  assert.equal((await info.GET(request('info'))).status, 429);
  assert.equal((await balance.GET(request('balance'))).status, 429, 'Both paths share the IP budget');
  assert.equal(reads, 60);
  assert.equal([...counters].find(([key]) => key.includes(':global:'))[1], 300, 'Rejected requests do not drain the global bucket');
  unavailable = true;
  assert.equal((await balance.GET(request('balance'))).status, 503);
  assert.equal(reads, 60);
});

await test('F02: complete pinned stake snapshot; transport and partial reads cannot become empty success', async () => {
  const { readStakeLeaderboard } = await loadSource('lib/stake-leaderboard-read.ts');
  const bounds = () => new ContractFunctionRevertedError({ abi: [], data: `0x4e487b71${'32'.padStart(64, '0')}`, functionName: 'stakersArray' });
  const addresses = [address, other, `0x${'0'.repeat(40)}`];
  const seenBlocks = [];
  const client = {
    getBlockNumber: async () => 123n,
    readContract: async args => { seenBlocks.push(args.blockNumber); if (args.args[0] >= 3n) throw bounds(); return addresses[Number(args.args[0])]; },
    multicall: async args => {
      seenBlocks.push(args.blockNumber);
      assert.equal(args.allowFailure, false);
      return args.contracts.map(call => call.functionName === 'stakersArray' ? addresses[Number(call.args[0])]
        : [0n, 0n, call.args[0] === address ? 10n ** 18n : 0n]);
    },
  };
  assert.deepEqual(await readStakeLeaderboard(client, address), [{ address, staked: 10n ** 18n }]);
  assert.ok(seenBlocks.every(block => block === 123n));
  await assert.rejects(readStakeLeaderboard({ ...client, multicall: async () => [] }, address), /Incomplete/);
  await assert.rejects(readStakeLeaderboard({ ...client, readContract: async () => { throw new Error('RPC timeout'); } }, address), /RPC timeout/);
  assert.deepEqual(await readStakeLeaderboard({ ...client, readContract: async () => { throw bounds(); } }, address), []);
  const emptyBounds = new ContractFunctionRevertedError({ abi: [], functionName: 'stakersArray', cause: new Error('execution reverted') });
  assert.deepEqual(await readStakeLeaderboard({ ...client, readContract: async () => { throw emptyBounds; } }, address), [], 'Deployed getter uses an empty EVM revert');
  let cached = false;
  const service = await loadSource('lib/stake-leaderboard-service.ts', {
    './contracts': { getReadClient: () => ({ ...client, getBlockNumber: async () => { throw new Error('RPC timeout'); } }), STAKE_CONTRACT_ADDRESS: address },
    './redis': { redis: { get: async () => null, setex: async () => { cached = true; } } },
    './ens-resolver': { resolvePrimaryNames: async () => new Map() },
  });
  const route = await loadSource('app/api/leaderboard/stake/route.ts', { '@/lib/stake-leaderboard-service': service });
  const response = await route.GET();
  assert.equal(response.status, 503);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(cached, false);
});

await test('F04: notification history handles actual SDK objects, strings, and malformed rows', async () => {
  const time = '2026-09-12T12:00:00.000Z';
  const audience = { id: 'audience', provider: 'base', status: 'completed', trigger: 'cron', startedAt: time, completedAt: time, pagesFetched: 1, usersFetched: 3, uniqueAddresses: 3 };
  const care = { id: 'care', provider: 'base', startedAt: time, completedAt: time, dryRun: false, totalRecipients: 3, notified: 3, eligiblePlants: 3, elapsedMs: 100 };
  const sdk = new Redis({ request: async () => ({ result: [JSON.stringify(audience), JSON.stringify(care)] }) });
  const sdkRows = await sdk.lrange('fixture', 0, 9);
  assert.equal(typeof sdkRows[0], 'object');
  const storage = await loadSource('lib/notifications/storage.ts', { '@/lib/redis': { redis: {
    get: async () => null,
    lrange: async () => [...sdkRows, JSON.stringify(audience), JSON.stringify(care), '{invalid', 7, {}],
  } } });
  assert.deepEqual(await storage.listBaseAudienceHistory(), [audience, audience]);
  assert.deepEqual((await storage.getPlantCareStats('base')).recent, [care, care]);
});

await test('F05: progress, later batch, and prune failures retain acknowledged delivery evidence', async () => {
  let calls = 0;
  let failSecond = false;
  let failPrune = false;
  globalThis.fetch = async (_url, options) => {
    calls++;
    if (failSecond && calls === 2) return Response.json({ error: 'failure' }, { status: 400 });
    const recipients = JSON.parse(options.body).wallet_addresses;
    return Response.json({ results: recipients.map(walletAddress => ({ walletAddress, sent: !failPrune, ...(failPrune ? { failureReason: 'User has notifications disabled' } : {}) })) });
  };
  try {
    const api = await loadSource('lib/notifications/base-api.ts', {
      '@/lib/env-config': { CLIENT_ENV: { APP_URL: 'https://fixture.invalid' }, SERVER_ENV: { BASE_NOTIFICATIONS_API_KEY: 'fixture' } },
      '@/lib/notifications/constants': { BASE_NOTIFICATIONS_API_BASE_URL: 'https://fixture.invalid', BASE_REQUEST_INTERVAL_MS: 0, BASE_SEND_BATCH_SIZE: 1 },
      '@/lib/notifications/storage': { pruneBaseAudienceAddressesFromCurrentSnapshot: async () => { throw new Error('Prune unavailable'); } },
    });
    const options = { addresses: [address, other], title: 'fixture', message: 'fixture', pacingMs: 0 };
    await assert.rejects(api.sendBaseNotificationsInChunks({ ...options, onBatchComplete: () => { throw new Error('Progress unavailable'); } }), error => {
      assert.equal(error.partialResponse.sentCount, 1); assert.equal(error.partialResponse.batches.length, 1); return true;
    });
    assert.equal(calls, 1, 'Stop before sending another batch after progress failure');
    calls = 0; failSecond = true;
    await assert.rejects(api.sendBaseNotificationsInChunks(options), error => { assert.equal(error.partialResponse.sentCount, 1); return true; });
    calls = 0; failSecond = false; failPrune = true;
    await assert.rejects(api.sendBaseNotificationsInChunks(options), error => { assert.equal(error.partialResponse.failedCount, 2); assert.equal(error.partialResponse.batches.length, 2); return true; });
  } finally { globalThis.fetch = noNetwork; }
  const delivery = { success: true, totalRequested: 1, sentCount: 1, failedCount: 0, batches: [], failures: [], prunedSnapshotCount: 0 };
  let resultWrites = 0;
  let failedMeta;
  const campaign = await loadSource('lib/notifications/campaigns.ts', {
    '@/lib/env-config': { SERVER_ENV: { NOTIFICATION_PROVIDER: 'base' } },
    '@/lib/notifications/base-api': { sendBaseNotificationsInChunks: async () => delivery },
    '@/lib/notifications/storage': {
      getCurrentBaseAudienceSnapshotMeta: async () => null, getCurrentBaseAudienceAddresses: async () => [],
      createCampaignMeta: async input => ({ ...input, id: 'fixture' }), acquireBaseApiLock: async () => true,
      releaseBaseApiLock: async () => {}, setCampaignProgress: async () => {},
      setCampaignResults: async (_id, result) => { resultWrites++; if (resultWrites === 1) throw new Error('Final write failed'); assert.equal(result.sentCount, 1); },
      updateCampaignMeta: async (_id, meta) => { failedMeta = meta; return meta; },
    },
  });
  await assert.rejects(campaign.sendBaseCampaign({ audienceMode: 'selected', walletAddresses: [address], title: 'fixture', message: 'fixture' }), /Final write failed/);
  assert.equal(failedMeta.sentCount, 1, 'Post-send persistence failure cannot reset known deliveries to zero');
});

await test('F06: Solana timeout bounds initial, polling, and expiry RPCs without late success', async () => {
  const lifecycle = await loadSource('lib/solana-bridge-lifecycle.ts', { './base-rpc': { getBaseReadClient: () => ({}) } });
  const never = new Promise(() => {});
  let lateResolve;
  const phases = [];
  const initial = new Promise(resolve => { lateResolve = resolve; });
  for (const connection of [
    { confirmTransaction: () => initial },
    { confirmTransaction: async () => { throw new Error('transport'); }, getSignatureStatuses: () => never },
    { confirmTransaction: async () => { throw new Error('expired'); }, getSignatureStatuses: () => never, getAccountInfo: () => never, getBlockHeight: () => never },
  ]) {
    const start = Date.now();
    await assert.rejects(lifecycle.confirmSolanaTransaction(connection, 'fixture', {
      timeoutMs: 20, pollMs: 1, lastValidBlockHeight: 10, outgoingMessageAddress: '11111111111111111111111111111111', onPhase: phase => phases.push(phase),
    }), lifecycle.SolanaConfirmationTimeoutError);
    assert.ok(Date.now() - start < 1000);
  }
  lateResolve({ value: { err: null } });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(!phases.includes('solana-confirmed'));
  await lifecycle.confirmSolanaTransaction({ confirmTransaction: async () => ({ value: { err: null } }) }, 'fixture', { timeoutMs: 20 });
});

await test('F07: sponsorship requires a usable URL; Max no longer waives gas for optional sponsorship', async () => {
  const { resolvePaymasterUrl } = await loadSource('lib/paymaster-config.ts');
  assert.equal(resolvePaymasterUrl(), undefined);
  assert.equal(resolvePaymasterUrl('invalid', 'https://sponsor.invalid/pay'), 'https://sponsor.invalid/pay');
  assert.equal(resolvePaymasterUrl('http://sponsor.invalid'), undefined);
  process.env.NEXT_PUBLIC_PAYMASTER_ENABLED = 'true';
  process.env.NEXT_PUBLIC_CDP_CLIENT_API_KEY = 'fixture';
  delete process.env.NEXT_PUBLIC_CDP_PAYMASTER_URL;
  delete process.env.NEXT_PUBLIC_PAYMASTER_SERVICE_URL;
  let context = await loadSource('lib/paymaster-context.tsx');
  assert.equal(context.PaymasterProvider({ children: null }).props.value.isSponsored, false);
  process.env.NEXT_PUBLIC_PAYMASTER_SERVICE_URL = 'https://sponsor.invalid';
  delete process.env.NEXT_PUBLIC_CDP_CLIENT_API_KEY;
  context = await loadSource('lib/paymaster-context.tsx');
  assert.equal(context.PaymasterProvider({ children: null }).props.value.isSponsored, true);
  const panel = readFileSync('components/tabs/pixotchi-swap-panel.tsx', 'utf8');
  assert.doesNotMatch(panel, /isSponsored/);
  assert.match(panel, /const affordable = balance - fee/);
});

await test('F08: verify claims distinguish retryable, processing, complete, inconsistent, and unavailable', async () => {
  const values = new Map();
  const client = { get: async key => values.get(key) ?? null };
  const records = await loadSource('lib/verify-claim-records.ts', { '@/lib/redis': { redis: client } });
  const record = records.createVerifyClaimReservation({ userAddress: address, verificationToken: 'fixture', provider: 'base', strainId: 1 });
  const setPair = record => { values.set(records.getVerifyWalletClaimKey(address), record); values.set(records.getVerifyClaimKey('fixture'), JSON.stringify(record)); };
  assert.equal((await records.readVerifyWalletClaimState(address)).claimState, 'unclaimed');
  setPair(record);
  assert.equal((await records.readVerifyWalletClaimState(address)).claimState, 'processing');
  setPair({ ...record, status: 'claim_failed_before_submission', stage: 'failed_before_submission' });
  const retry = await records.readVerifyWalletClaimState(address);
  assert.equal(retry.claimed, false); assert.equal(retry.retryable, true); assert.equal(retry.blocksNewClaim, false);
  assert.ok(!JSON.stringify(retry).includes('idempotencyKeys'));
  setPair({ ...record, status: 'complete', stage: 'complete', tokenId: '1' });
  assert.equal((await records.readVerifyWalletClaimState(address)).claimed, true);
  values.delete(records.getVerifyClaimKey('fixture'));
  assert.equal((await records.readVerifyWalletClaimState(address)).claimState, 'manual_review');
  await assert.rejects(records.readVerifyWalletClaimState(address, null), /unavailable/);
  assert.match(readFileSync('lib/ai-read-tools.ts', 'utf8'), /readVerifyWalletClaimState\(lower\)/);
});

await test('F09: real SDK generation, streaming, and tool steps share an input-inclusive allowance', async () => {
  const { AIProviderBudget, AIRequestBudgetExceededError, estimateAIInputAllowance } = await loadSource('lib/ai-provider-budget.ts');
  let invocations = 0;
  const usage = (input, output) => ({ inputTokens: { total: input }, outputTokens: { total: output } });
  const model = {
    specificationVersion: 'v4', provider: 'fixture', modelId: 'fixture', supportedUrls: {},
    doGenerate: async params => {
      invocations++;
      return { content: [{ type: 'text', text: 'fixture' }], finishReason: { unified: 'stop', raw: 'stop' },
        usage: usage(estimateAIInputAllowance(params), params.maxOutputTokens), warnings: [] };
    },
    doStream: async params => {
      invocations++;
      return { stream: new ReadableStream({ start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'text-start', id: '1' });
        controller.enqueue({ type: 'text-delta', id: '1', delta: 'fixture' });
        controller.enqueue({ type: 'text-end', id: '1' });
        controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: usage(estimateAIInputAllowance(params), params.maxOutputTokens) });
        controller.close();
      } }) };
    },
  };
  const tiny = new AIProviderBudget(100);
  await assert.rejects(generateText({ model: wrapLanguageModel({ model, middleware: tiny.middleware }), prompt: 'hello', maxOutputTokens: 100, maxRetries: 0 }), AIRequestBudgetExceededError);
  assert.equal(invocations, 0); assert.equal(tiny.started, false);
  const shared = new AIProviderBudget(4000);
  const wrapped = wrapLanguageModel({ model, middleware: shared.middleware });
  await generateText({ model: wrapped, prompt: 'hello', maxOutputTokens: 400, maxRetries: 0 });
  const stream = streamText({ model: wrapped, prompt: 'hello', maxOutputTokens: 400, maxRetries: 0 });
  assert.equal(await stream.text, 'fixture');
  await assert.rejects(generateText({ model: wrapped, prompt: 'continue', maxOutputTokens: 400, maxRetries: 0 }), AIRequestBudgetExceededError);
  assert.equal(invocations, 2);
  const loopBudget = new AIProviderBudget(2500);
  const toolModel = { ...model, doGenerate: async params => {
    invocations++;
    return { content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'read', input: '{}' }], finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
      usage: usage(estimateAIInputAllowance(params), params.maxOutputTokens), warnings: [] };
  } };
  await assert.rejects(generateText({ model: wrapLanguageModel({ model: toolModel, middleware: loopBudget.middleware }), prompt: 'read', maxOutputTokens: 500, maxRetries: 0,
    tools: { read: tool({ inputSchema: z.object({}), execute: async () => 'result' }) }, stopWhen: isStepCount(8),
  }), AIRequestBudgetExceededError);
  assert.equal(invocations, 3, 'Later tool steps stop before calling a provider');
  const unknownBudget = new AIProviderBudget(2000);
  const unknownModel = wrapLanguageModel({ model: { ...model, doGenerate: async () => {
    invocations++; throw new Error('Provider disconnected after accepting work');
  } }, middleware: unknownBudget.middleware });
  await assert.rejects(generateText({ model: unknownModel, prompt: 'hello', maxOutputTokens: 500, maxRetries: 0 }), /Provider disconnected/);
  await assert.rejects(generateText({ model: unknownModel, prompt: 'retry', maxOutputTokens: 500, maxRetries: 0 }), AIRequestBudgetExceededError);
  assert.equal(invocations, 4, 'Unknown usage retains its allowance and prevents an unbudgeted retry');
});

await test('F10: historical tokens are not repriced with the active provider and unknown cost reaches the UI', async () => {
  const conversation = { id: 'fixture', address, title: 'Fixture', model: 'previous-model', createdAt: 1, lastMessageAt: 2, messageCount: 10, totalTokens: 1_000_000 };
  const service = await loadSource('lib/ai-service.ts', {
    './redis': { redis: { smembers: async key => key === 'ai:conversations:index' ? ['fixture'] : [], mget: async () => [conversation] }, redisScanKeysRaw: async () => [], redisScanKeysRawStrict: async () => [] },
    './ai-read-tools': { createReadOnlyAITools: () => ({}), createReadOnlyAIToolsContext: () => ({}), executeReadOnlyAITool: async () => null },
    './chat-service': { formatDisplayName: () => 'fixture' },
  });
  const stats = await service.getAIUsageStats();
  assert.equal(stats.totalTokens, 1_000_000); assert.equal(stats.costEstimate, null);
  const { parseAdminAiSnapshot } = await loadSource('lib/admin-view-data.ts');
  assert.equal(parseAdminAiSnapshot({ conversations: [conversation], stats }).stats.costEstimate, null);
});

console.log(`${passed} offline audit groups passed. Chat concurrency is covered by audit:regressions against isolated Redis.`);
