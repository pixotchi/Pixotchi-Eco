import { questConfigurationIdentity, validateQuestConfiguration, type QuestConfiguration } from './quest-configuration';

/** Preserve the reserve policy: cover one maximum payout at the largest configured multiplier. */
export function getQuestRewardRequirements(configuration: QuestConfiguration) {
  validateQuestConfiguration(configuration);
  const multiplier = configuration.difficulties.reduce((maximum, difficulty) =>
    difficulty.rewardMultiplier > maximum ? difficulty.rewardMultiplier : maximum, BigInt(0));
  return { seed: configuration.ranges.maxSeedReward * multiplier, leaf: configuration.ranges.maxLeafReward * multiplier };
}

export type QuestRewardFunding = {
  seedBalance: bigint;
  seedAllowance: bigint;
  leafBalance: bigint;
  leafAllowance: bigint;
  sources: { resolvedOnchain: boolean };
  configuration: QuestConfiguration;
};

export function canSettleQuestRewards(funding: QuestRewardFunding): boolean {
  let required: ReturnType<typeof getQuestRewardRequirements>;
  try { required = getQuestRewardRequirements(funding.configuration); } catch { return false; }
  return funding.sources.resolvedOnchain
    && funding.seedBalance >= required.seed
    && funding.seedAllowance >= required.seed
    && funding.leafBalance >= required.leaf
    && funding.leafAllowance >= required.leaf;
}

/** A fresh read is essential before commit starts the finite opening window. */
export async function requireQuestRewardsReady(read: () => Promise<QuestRewardFunding>, reviewedConfiguration?: QuestConfiguration): Promise<void> {
  let funding: QuestRewardFunding;
  try {
    funding = await read();
  } catch {
    throw new Error("We couldn't check quest rewards. Retry before returning your farmer.");
  }
  if (!funding.sources.resolvedOnchain) {
    throw new Error("We couldn't verify quest rewards. Retry before returning your farmer.");
  }
  try { getQuestRewardRequirements(funding.configuration); } catch {
    throw new Error("We couldn't verify quest reward settings. Retry before starting or returning.");
  }
  if (reviewedConfiguration && questConfigurationIdentity(funding.configuration) !== questConfigurationIdentity(reviewedConfiguration)) {
    throw new Error('Quest terms changed. Review the updated duration and rewards before starting.');
  }
  if (!canSettleQuestRewards(funding)) {
    throw new Error('Quest rewards are temporarily unavailable. Your farmer can safely wait before returning.');
  }
}

/** A committed quest's actual reward, rather than the whole pool float, decides recovery. */
export async function requireQuestFinalizeReady(simulate: () => Promise<boolean>, isCurrent: () => boolean): Promise<void> {
  let awardsReward: boolean;
  try {
    awardsReward = await simulate();
  } catch {
    throw new Error("We couldn't verify opening this loot bag. Retry before its deadline.");
  }
  if (!isCurrent()) throw new Error('Your wallet or land changed. Review the selected quest before opening.');
  if (!awardsReward) throw new Error('This loot bag has expired. Refresh quests to reset it.');
}
