import { getReadClient, LAND_CONTRACT_ADDRESS, type PixotchiReadClient } from './contracts';
import { landAbi } from '@/public/abi/pixotchi-v3-abi';

/** Gate new starts without removing slots or changing a batch's paid-run state. */
export async function requireFarmerHouseStartsReady(
  landIds: readonly bigint[],
  isCurrent: () => boolean,
  client: Pick<PixotchiReadClient, 'getBlockNumber' | 'multicall'> = getReadClient(),
): Promise<void> {
  const requireCurrent = () => {
    if (!isCurrent()) throw new Error('Your wallet or land changed. Review the selected quests again.');
  };
  requireCurrent();
  const uniqueIds = [...new Set(landIds)];
  let blockNumber: bigint;
  try { blockNumber = await client.getBlockNumber({ cacheTime: 0 }); }
  catch { throw new Error('Could not verify Farmer House construction. Retry before starting quests.'); }
  requireCurrent();
  for (let offset = 0; offset < uniqueIds.length; offset += 40) {
    const chunk = uniqueIds.slice(offset, offset + 40);
    let results;
    try {
      results = await client.multicall({
        allowFailure: true, blockNumber,
        contracts: chunk.map(landId => ({
          address: LAND_CONTRACT_ADDRESS, abi: landAbi,
          functionName: 'townGetBuildingsByLandId' as const, args: [landId],
        })),
      });
    } catch { throw new Error('Could not verify Farmer House construction. Retry before starting quests.'); }
    requireCurrent();
    for (let index = 0; index < chunk.length; index += 1) {
      const result = results[index];
      const house = result?.status === 'success' && Array.isArray(result.result)
        ? result.result.find(building => building.id === 7) : undefined;
      if (!house || typeof house.isUpgrading !== 'boolean' || house.level <= 0) {
        throw new Error(`Could not verify the Farmer House on Land #${chunk[index]}. Refresh before starting quests.`);
      }
      if (house.isUpgrading) {
        throw new Error(`Farmer House on Land #${chunk[index]} is upgrading. New quests are paused until construction finishes; your batch run is unchanged.`);
      }
    }
  }
}
