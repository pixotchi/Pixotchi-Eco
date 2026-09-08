import { getReadClient, LAND_CONTRACT_ADDRESS, type PixotchiReadClient } from './contracts';
import { questConfigurationAbi, validateQuestConfiguration, type QuestConfiguration } from './quest-configuration';

export async function readQuestConfiguration(client: PixotchiReadClient = getReadClient()): Promise<QuestConfiguration> {
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const [difficulties, ranges] = await Promise.all([
    Promise.all([0, 1, 2].map(async difficulty => {
      const [durationInBlocks, cooldownInBlocks, rewardMultiplier] = await client.readContract({
        address: LAND_CONTRACT_ADDRESS, abi: questConfigurationAbi, functionName: 'questGetDifficultyConfig', args: [difficulty], blockNumber,
      });
      return { durationInBlocks, cooldownInBlocks, rewardMultiplier };
    })),
    client.readContract({ address: LAND_CONTRACT_ADDRESS, abi: questConfigurationAbi, functionName: 'questGetAllRewardRanges', blockNumber }),
  ]);
  return validateQuestConfiguration({ difficulties, ranges });
}
