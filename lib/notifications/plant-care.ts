import { differenceInSeconds } from 'date-fns';
import { getAliveTokenIds, getPlantsInfoExtended } from '@/lib/contracts';
import { PLANT_CARE_THRESHOLD_SECONDS } from '@/lib/notifications/constants';
import { chunkArray, normalizeWalletAddress, sleep } from '@/lib/notifications/utils';

export type DuePlantSummary = {
  id: number;
  hoursLeft: number;
  secondsLeft: number;
};

export type DuePlantOwnerSummary = {
  address: string;
  duePlants: DuePlantSummary[];
  totalPlants: number;
};

type CollectDuePlantsOptions = {
  now?: Date;
  clearSafePlantEpisode?: (address: string, plantId: number) => Promise<void>;
};

const PLANT_INFO_CHUNK_SIZE = 100;
const PLANT_INFO_CONCURRENCY = 4;
const PLANT_INFO_BATCH_DELAY_MS = 50;

export async function collectDuePlantsByOwner(
  options: CollectDuePlantsOptions = {},
): Promise<DuePlantOwnerSummary[]> {
  const now = options.now ?? new Date();
  const tokenIds = await getAliveTokenIds();
  if (tokenIds.length === 0) {
    return [];
  }

  const owners = new Map<string, DuePlantOwnerSummary>();
  const chunks = chunkArray(tokenIds, PLANT_INFO_CHUNK_SIZE);

  for (let i = 0; i < chunks.length; i += PLANT_INFO_CONCURRENCY) {
    const group = chunks.slice(i, i + PLANT_INFO_CONCURRENCY);
    const results = await Promise.allSettled(group.map((chunk) => getPlantsInfoExtended(chunk)));

    for (const result of results) {
      if (result.status !== 'fulfilled') {
        continue;
      }

      for (const plant of result.value) {
        const owner = normalizeWalletAddress(plant.owner);
        if (!owner) {
          continue;
        }

        const secondsLeft = differenceInSeconds(new Date(Number(plant.timeUntilStarving || 0) * 1000), now);
        const entry = owners.get(owner) || {
          address: owner,
          duePlants: [],
          totalPlants: 0,
        };

        entry.totalPlants += 1;

        if (secondsLeft > PLANT_CARE_THRESHOLD_SECONDS && options.clearSafePlantEpisode) {
          await options.clearSafePlantEpisode(owner, Number(plant.id));
        }

        if (secondsLeft > 0 && secondsLeft <= PLANT_CARE_THRESHOLD_SECONDS) {
          entry.duePlants.push({
            id: Number(plant.id),
            hoursLeft: Math.round((secondsLeft / 3600) * 100) / 100,
            secondsLeft,
          });
        }

        owners.set(owner, entry);
      }
    }

    if (i + PLANT_INFO_CONCURRENCY < chunks.length) {
      await sleep(PLANT_INFO_BATCH_DELAY_MS);
    }
  }

  return Array.from(owners.values())
    .filter((entry) => entry.duePlants.length > 0)
    .sort((left, right) => left.address.localeCompare(right.address));
}
