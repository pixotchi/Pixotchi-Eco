// Exercise the shared browser/AI funding reader with controlled contract I/O.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const result = await build({
  stdin: { contents: `export {readQuestRewardsSnapshot} from '@/lib/quest-rewards-read';
    export {canSettleQuestRewards} from '@/lib/quest-rewards-readiness';
    export {fixtureQuestConfiguration} from '@/app/qa/building-guards/quest-data';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'contract-io', setup(builder) {
    builder.onResolve({ filter: /(^|\/)contracts$/ }, () => ({ path: 'contracts', namespace: 'funding' }));
    builder.onLoad({ filter: /.*/, namespace: 'funding' }, () => ({ loader: 'js', contents: `
      export const LAND_CONTRACT_ADDRESS='0x1111111111111111111111111111111111111111';
      export const PIXOTCHI_TOKEN_ADDRESS='0x2222222222222222222222222222222222222222';
      export const LEAF_CONTRACT_ADDRESS='0x3333333333333333333333333333333333333333';
      export const ERC20_BALANCE_ABI=[];
      export const getReadClient=()=>{throw Error('Explicit client required in test')};
      export const getQuestRewardSources=async client=>client.sources;
    ` }));
  } }],
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(path.resolve('package.json')), compiled, compiled.exports);
const { readQuestRewardsSnapshot, canSettleQuestRewards, fixtureQuestConfiguration } = compiled.exports;
let configuration = fixtureQuestConfiguration;
let failure = null;
const reads = [];
const client = {
  sources: { seed: 'source-a', leaf: 'source-b', resolvedOnchain: true },
  getBlockNumber: async () => 123n,
  readContract: async request => {
    reads.push(request);
    if (failure === 'configuration') throw Error('settings unavailable');
    if (request.functionName === 'questGetAllRewardRanges') return configuration.ranges;
    const d = configuration.difficulties[request.args[0]];
    return [d.durationInBlocks, d.cooldownInBlocks, d.rewardMultiplier];
  },
  multicall: async request => {
    assert.deepEqual(request.contracts.map(c => c.args[0]), [client.sources.seed, client.sources.seed, client.sources.leaf, client.sources.leaf]);
    return [12n, 12n, 50001n, 50001n].map((amount, index) => failure === index
      ? { status: 'failure', error: Error('read unavailable') }
      : { status: 'success', result: amount * 10n ** 18n });
  },
};
assert.equal(canSettleQuestRewards(await readQuestRewardsSnapshot(client)), true);
assert.equal(reads.length, 4);
assert.ok(reads.every(read => read.blockNumber === 123n), 'all difficulty/range settings share the observed block');
configuration = { ...configuration, ranges: { ...configuration.ranges, maxSeedReward: 5n * 10n ** 18n } };
assert.equal(canSettleQuestRewards(await readQuestRewardsSnapshot(client)), false, 'changed settings invalidate the old maximum reserve');
client.sources = { seed: 'rotated-seed', leaf: 'rotated-leaf', resolvedOnchain: true };
assert.equal((await readQuestRewardsSnapshot(client)).sources.seed, 'rotated-seed');
for (failure of [0, 1, 2, 3, 'configuration']) await assert.rejects(readQuestRewardsSnapshot(client));
failure = null;
client.sources.resolvedOnchain = false;
await assert.rejects(readQuestRewardsSnapshot(client), /reward source/);
const ai = readFileSync('lib/ai-read-tools.ts', 'utf8');
const consumer = ai.slice(ai.indexOf('get_quest_readiness: tool('), ai.indexOf('get_leaderboards: tool('));
assert.match(consumer, /readQuestRewardsSnapshot\(readClient\)/);
assert.match(consumer, /canSettleQuestRewards\(funding\)/);
assert.doesNotMatch(consumer, /MIN_QUEST|QUEST_SEED_REWARDS_WALLET|opening loot bags is paused/);
assert.match(consumer, /Wait before using Return/);
assert.match(consumer, /fundingDetails: createCustodyRedaction/);
console.log('Shared quest funding read smoke passed: fresh configuration/source, four failed reads, changed reserve and AI consumer alignment.');
