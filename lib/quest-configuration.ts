import { parseAbi } from 'viem';

// Read-only getters in AccessControlFacet.sol. No deployment defaults are treated as current terms.
export const questConfigurationAbi = parseAbi([
  'function questGetDifficultyConfig(uint8 difficulty) view returns (uint256 durationInBlocks, uint256 cooldownInBlocks, uint256 rewardMultiplier)',
  'function questGetAllRewardRanges() view returns ((uint256 minSeedReward, uint256 maxSeedReward, uint256 minLeafReward, uint256 maxLeafReward, uint256 minPlantLifetimeReward, uint256 maxPlantLifetimeReward, uint256 minPlantPointsReward, uint256 maxPlantPointsReward, uint256 minXpReward, uint256 maxXpReward) ranges)',
]);

export type QuestDifficultyConfiguration = { durationInBlocks: bigint; cooldownInBlocks: bigint; rewardMultiplier: bigint };
export type QuestRewardRanges = Record<'minSeedReward' | 'maxSeedReward' | 'minLeafReward' | 'maxLeafReward'
  | 'minPlantLifetimeReward' | 'maxPlantLifetimeReward' | 'minPlantPointsReward' | 'maxPlantPointsReward' | 'minXpReward' | 'maxXpReward', bigint>;
export type QuestConfiguration = { difficulties: QuestDifficultyConfiguration[]; ranges: QuestRewardRanges };

export function validateQuestConfiguration(config: QuestConfiguration): QuestConfiguration {
  if (config.difficulties.length !== 3 || config.difficulties.some(value => typeof value.durationInBlocks !== 'bigint' || typeof value.cooldownInBlocks !== 'bigint' || typeof value.rewardMultiplier !== 'bigint'
    || value.durationInBlocks <= BigInt(0) || value.cooldownInBlocks < BigInt(0) || value.rewardMultiplier <= BigInt(0))) {
    throw new Error('Quest difficulty settings are unavailable.');
  }
  for (const resource of ['Seed', 'Leaf', 'PlantLifetime', 'PlantPoints', 'Xp'] as const) {
    const min = config.ranges[`min${resource}Reward`];
    const max = config.ranges[`max${resource}Reward`];
    if (typeof min !== 'bigint' || typeof max !== 'bigint' || min <= BigInt(0) || max < min) throw new Error('Quest reward ranges are unavailable.');
  }
  return config;
}

export function questConfigurationIdentity(config: QuestConfiguration): string {
  return JSON.stringify(config, (_, value) => typeof value === 'bigint' ? value.toString() : value);
}
