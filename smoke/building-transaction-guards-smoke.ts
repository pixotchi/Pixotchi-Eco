import assert from 'node:assert/strict';
import { canSettleQuestRewards, requireQuestRewardsReady, requireQuestFinalizeReady, getQuestRewardRequirements } from '../lib/quest-rewards-readiness';
import { fixtureQuestConfiguration } from '../app/qa/building-guards/quest-data';
import { getRaidPreviewIdentity, getCurrentRaidPreview, requireCurrentRaidPreview } from '../lib/barracks-preview-readiness';
import type { BarracksRaidPreviewV2 } from '../lib/types';

async function main() {
  const required = getQuestRewardRequirements(fixtureQuestConfiguration);
  assert.equal(required.seed, BigInt(12) * BigInt(10) ** BigInt(18));
  assert.equal(required.leaf, BigInt(50001) * BigInt(10) ** BigInt(18));
  const funded = { seedBalance: required.seed, seedAllowance: required.seed, leafBalance: required.leaf, leafAllowance: required.leaf,
    sources: { resolvedOnchain: true }, configuration: fixtureQuestConfiguration };
  assert.equal(canSettleQuestRewards(funded), true, 'the exact funding threshold is sufficient');
  for (const field of ['seedBalance', 'seedAllowance', 'leafBalance', 'leafAllowance'] as const) {
    const insufficient = { ...funded, [field]: funded[field] - BigInt(1) };
    assert.equal(canSettleQuestRewards(insufficient), false);
    await assert.rejects(requireQuestRewardsReady(async () => insufficient), /safely wait/);
  }
  await assert.rejects(requireQuestRewardsReady(async () => ({ ...funded, sources: { resolvedOnchain: false } })), /couldn't verify/);
  await assert.rejects(requireQuestRewardsReady(async () => { throw new Error('RPC failed'); }), /couldn't check/);
  await requireQuestRewardsReady(async () => funded, fixtureQuestConfiguration);
  const changedTerms = { ...fixtureQuestConfiguration, difficulties: fixtureQuestConfiguration.difficulties.map((difficulty, index) => ({ ...difficulty, durationInBlocks: difficulty.durationInBlocks + (index === 0 ? BigInt(1) : BigInt(0)) })) };
  await assert.rejects(requireQuestRewardsReady(async () => ({ ...funded, configuration: changedTerms }), fixtureQuestConfiguration), /Quest terms changed/);
  // The reserve follows current settings, including a non-Hard difficulty becoming the largest multiplier.
  const increased = { ...fixtureQuestConfiguration, difficulties: fixtureQuestConfiguration.difficulties.map((difficulty, index) => ({ ...difficulty, rewardMultiplier: index === 0 ? BigInt(5) : difficulty.rewardMultiplier })) };
  assert.equal(getQuestRewardRequirements(increased).seed, BigInt(20) * BigInt(10) ** BigInt(18));
  await assert.rejects(requireQuestRewardsReady(async () => ({ ...funded, configuration: increased })), /safely wait/);
  const changedRange = { ...fixtureQuestConfiguration, ranges: { ...fixtureQuestConfiguration.ranges, maxLeafReward: fixtureQuestConfiguration.ranges.maxLeafReward + BigInt(1) } };
  await assert.rejects(requireQuestRewardsReady(async () => ({ ...funded, configuration: changedRange })), /safely wait/);
  const invalidSettings = { ...fixtureQuestConfiguration, difficulties: [] };
  assert.equal(canSettleQuestRewards({ ...funded, configuration: invalidSettings }), false);
  await assert.rejects(requireQuestRewardsReady(async () => ({ ...funded, configuration: invalidSettings })), /couldn't verify quest reward settings/);
  await assert.rejects(requireQuestRewardsReady(async () => { throw new Error('Quest configuration read failed'); }), /couldn't check/);
  await requireQuestFinalizeReady(async () => true, () => true);
  await assert.rejects(requireQuestFinalizeReady(async () => false, () => true), /expired/);
  await assert.rejects(requireQuestFinalizeReady(async () => true, () => false), /wallet or land changed/);
  await assert.rejects(requireQuestFinalizeReady(async () => { throw new Error('Actual reward cannot settle'); }, () => true), /couldn't verify/);

  const identity = getRaidPreviewIdentity('Wallet-A', BigInt(1), BigInt(2), BigInt(10), BigInt(0));
  assert.equal(identity, getRaidPreviewIdentity('wallet-a', BigInt(1), BigInt(2), BigInt(10), BigInt(0)));
  for (const troopCount of [null, BigInt(-1)]) assert.equal(getRaidPreviewIdentity('a', BigInt(1), BigInt(2), troopCount, BigInt(0)), null);
  assert.equal(getRaidPreviewIdentity('a', BigInt(1), BigInt(2), BigInt(0), BigInt(0)), null);
  const preview = { statusCode: 0 } as BarracksRaidPreviewV2;
  const ready = { identity: identity!, status: 'ready' as const, preview };
  assert.equal(getCurrentRaidPreview(ready, identity), preview);
  assert.doesNotThrow(() => requireCurrentRaidPreview(ready, identity));
  for (const changed of [
    getRaidPreviewIdentity('wallet-b', BigInt(1), BigInt(2), BigInt(10), BigInt(0)),
    getRaidPreviewIdentity('wallet-a', BigInt(3), BigInt(2), BigInt(10), BigInt(0)),
    getRaidPreviewIdentity('wallet-a', BigInt(1), BigInt(4), BigInt(10), BigInt(0)),
    getRaidPreviewIdentity('wallet-a', BigInt(1), BigInt(2), BigInt(20), BigInt(0)),
    getRaidPreviewIdentity('wallet-a', BigInt(1), BigInt(2), BigInt(10), BigInt(1)),
  ]) {
    assert.equal(getCurrentRaidPreview(ready, changed), null, 'stale information disappears before effects run');
    assert.throws(() => requireCurrentRaidPreview(ready, changed), /current raid preview/);
  }
  assert.throws(() => requireCurrentRaidPreview({ identity: identity!, status: 'loading' }, identity));
  assert.throws(() => requireCurrentRaidPreview({ ...ready, preview: { ...preview, statusCode: 8 } }, identity));
  console.log('Building transaction guards smoke passed');
}
void main();
