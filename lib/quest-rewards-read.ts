import { ERC20_BALANCE_ABI, LAND_CONTRACT_ADDRESS, LEAF_CONTRACT_ADDRESS, PIXOTCHI_TOKEN_ADDRESS, getQuestRewardSources, getReadClient, type QuestRewardSources, type PixotchiReadClient } from './contracts';
import { readQuestConfiguration } from './quest-configuration-read';
import type { QuestConfiguration } from './quest-configuration';

export type QuestRewardsSnapshot = {
  leafAllowance: bigint;
  leafBalance: bigint;
  seedAllowance: bigint;
  seedBalance: bigint;
  sources: QuestRewardSources;
  configuration: QuestConfiguration;
};

export async function readQuestRewardsSnapshot(readClient: PixotchiReadClient = getReadClient()): Promise<QuestRewardsSnapshot> {

  // The payer is whatever the diamond has in storage, which
  // `setQuestRewardsWallet` can rotate at any time. Resolving it per read means
  // a rotation can never leave this gate inspecting a stale, empty wallet.
  const [sources, configuration] = await Promise.all([
    getQuestRewardSources(readClient), readQuestConfiguration(readClient),
  ]);
  if (!sources.resolvedOnchain) throw new Error('Unable to verify the quest reward source.');

  const results = await readClient.multicall({
    allowFailure: true,
    contracts: [
      {
        abi: ERC20_BALANCE_ABI,
        address: PIXOTCHI_TOKEN_ADDRESS,
        args: [sources.seed],
        functionName: "balanceOf" as const,
      },
      {
        abi: ERC20_BALANCE_ABI,
        address: PIXOTCHI_TOKEN_ADDRESS,
        args: [sources.seed, LAND_CONTRACT_ADDRESS],
        functionName: "allowance" as const,
      },
      {
        abi: ERC20_BALANCE_ABI,
        address: LEAF_CONTRACT_ADDRESS,
        args: [sources.leaf],
        functionName: "balanceOf" as const,
      },
      {
        abi: ERC20_BALANCE_ABI,
        address: LEAF_CONTRACT_ADDRESS,
        args: [sources.leaf, LAND_CONTRACT_ADDRESS],
        functionName: "allowance" as const,
      },
    ],
  });

  const value = (index: number): bigint => {
    const entry = results[index];
    if (entry?.status !== "success" || typeof entry.result !== 'bigint') {
      throw new Error('Unable to read quest reward availability.');
    }
    return entry.result;
  };

  return {
    leafAllowance: value(3),
    leafBalance: value(2),
    seedAllowance: value(1),
    seedBalance: value(0),
    sources,
    configuration,
  };
}
