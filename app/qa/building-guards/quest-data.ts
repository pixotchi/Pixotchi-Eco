import type { QuestConfiguration } from '@/lib/quest-configuration';

/** Deterministic example terms for tests, never a production configuration fallback. */
export const fixtureQuestConfiguration: QuestConfiguration = {
  difficulties: [1, 2, 3].map((multiplier, index) => ({
    durationInBlocks: [BigInt(5400), BigInt(10800), BigInt(21600)][index],
    cooldownInBlocks: BigInt(21600), rewardMultiplier: BigInt(multiplier),
  })),
  ranges: {
    minSeedReward: BigInt(10) ** BigInt(18), maxSeedReward: BigInt(4) * BigInt(10) ** BigInt(18),
    minLeafReward: BigInt(5000) * BigInt(10) ** BigInt(18), maxLeafReward: BigInt(16667) * BigInt(10) ** BigInt(18),
    minPlantLifetimeReward: BigInt(3600), maxPlantLifetimeReward: BigInt(28800),
    minPlantPointsReward: BigInt(10) ** BigInt(12), maxPlantPointsReward: BigInt(33) * BigInt(10) ** BigInt(12),
    minXpReward: BigInt(10) ** BigInt(18), maxXpReward: BigInt(5) * BigInt(10) ** BigInt(18),
  },
};
