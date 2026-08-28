import 'server-only';

import { unstable_cache } from 'next/cache';
import { ActivityEvent, PlayedEvent } from './types';
import { getPlantsByOwner, getLandsByOwner } from './contracts';
import { fetchIndexerGraphQL } from './indexer-client';

const ALL_ACTIVITY_CACHE_SECONDS = 3;
const MY_ACTIVITY_CACHE_SECONDS = 5;

const ACTIVITY_WINDOW_SECONDS = 24 * 60 * 60;

/**
 * The indexer rejects any limit above this, so it is the hard ceiling for a
 * single collection in one request.
 */
const INDEXER_MAX_LIMIT = 1000;

/**
 * The public feed is an ambient ticker rather than a record, so it stays
 * deliberately truncated. Lifting it would push roughly 900 events per visit to
 * every client on a route that is `no-store`, for events nobody reads
 * exhaustively.
 */
const ALL_ACTIVITY_LIMIT = 100;

/**
 * The personal feed has to be complete - "who attacked me" is only useful if it
 * is. Paired with the window filter below the limit is a safety ceiling rather
 * than a payload driver: the response is exactly the wallet's real 24h activity,
 * so wallets with light activity pay nothing for the higher ceiling.
 */
const MY_ACTIVITY_LIMIT = INDEXER_MAX_LIMIT;

/**
 * Applied to every collection so the row limit bounds events *inside* the
 * window. Without it the indexer returns the newest N of all time and the
 * post-filter discards whatever falls outside, which both wastes payload and
 * silently truncates busy wallets.
 */
const ACTIVITY_WINDOW_FILTER = 'timestamp_gt: $cutoff';

/**
 * Cutoffs are floored into buckets so the request body stays byte-identical for
 * the whole bucket, which keeps the fetch cache warm instead of missing on every
 * request. Flooring only widens the window; `startsAt` trims the overshoot.
 */
const WINDOW_CUTOFF_BUCKET_SECONDS = 60;

type ActivityWindow = {
  /** Bucketed lower bound handed to the indexer as `$cutoff`. */
  cutoff: string;
  /** Exact 24h boundary used to trim the response. */
  startsAt: number;
};

function getActivityWindow(): ActivityWindow {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const startsAt = nowSeconds - ACTIVITY_WINDOW_SECONDS;
  const bucketed = Math.floor(startsAt / WINDOW_CUTOFF_BUCKET_SECONDS) * WINDOW_CUTOFF_BUCKET_SECONDS;

  return { cutoff: String(bucketed), startsAt };
}

function isMissingIncrementalCacheError(error: unknown): boolean {
  return error instanceof Error && /incrementalCache missing/i.test(error.message);
}

function filterToWindow(activities: ActivityEvent[], startsAt: number): ActivityEvent[] {
  return activities.filter(activity => Number(activity.timestamp) >= startsAt);
}

function getPlayedRewardWeight(event: PlayedEvent): number {
  const pointsDelta = Number(event.points ?? '0');
  const timeBonus = event.timeAdded ?? event.timeExtension ? Number(event.timeAdded ?? event.timeExtension ?? '0') : 0;
  const leafReward = event.leafAmount ? BigInt(event.leafAmount) : BigInt("0");

  let weight = 0;
  if (pointsDelta !== 0) weight += 1;
  if (timeBonus !== 0) weight += 2;
  if (leafReward !== BigInt("0")) weight += 4;

  return weight;
}

function dedupePlayedEvents(activities: ActivityEvent[]): ActivityEvent[] {
  const result: ActivityEvent[] = [];
  const seen = new Map<string, { index: number; weight: number }>();

  for (const activity of activities) {
    if (activity.__typename !== 'Played') {
      result.push(activity);
      continue;
    }

    const key = `${activity.nftId ?? activity.nftName}:${activity.timestamp}:${activity.gameName ?? ''}`.toLowerCase();
    const weight = getPlayedRewardWeight(activity);
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, { index: result.length, weight });
      result.push(activity);
      continue;
    }

    if (weight > existing.weight) {
      result[existing.index] = activity;
      existing.weight = weight;
    }
  }

  return result;
}

const GET_ALL_ACTIVITY_QUERY = `
  query GetAllActivity($cutoff: BigInt!) {
    attacks(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        attacker
        winner
        loser
        attackerName
        winnerName
        loserName
        scoresWon
      }
    }
    killeds(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        nftId
        deadId
        winnerName
        loserName
        reward
      }
    }
    mints(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        nftId
      }
    }
    playeds(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        nftName
        gameName
        points
        timeExtension
        timeAdded
        leafAmount
        rewardIndex
        player
      }
    }
    itemConsumeds(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        nftName
        giver
        itemId
      }
    }
    shopItemPurchaseds(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        nftName
        giver
        itemId
      }
    }
    landTransferEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        from
        to
        tokenId
        blockHeight
      }
    }
    landMintedEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        to
        tokenId
        mintPrice
        blockHeight
      }
    }
    landNameChangedEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        tokenId
        name
        blockHeight
      }
    }
    villageUpgradedWithLeafEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        landId
        buildingId
        upgradeCost
        xp
        blockHeight
      }
    }
    villageSpeedUpWithSeedEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        landId
        buildingId
        speedUpCost
        xp
        blockHeight
      }
    }
    townUpgradedWithLeafEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        landId
        buildingId
        upgradeCost
        xp
        blockHeight
      }
    }
    townSpeedUpWithSeedEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        landId
        buildingId
        speedUpCost
        xp
        blockHeight
      }
    }
    questStartedEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        landId
        farmerSlotId
        difficulty
        startBlock
        endBlock
        blockHeight
      }
    }
    questFinalizedEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        landId
        farmerSlotId
        player
        rewardType
        amount
        blockHeight
      }
    }
    villageProductionClaimedEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        landId
        buildingId
        blockHeight
      }
    }
    casinoBuiltEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        landId
        builder
        token
        cost
        blockHeight
      }
    }
    rouletteSpinResultEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        landId
        player
        winningNumber
        won
        payout
        bettingToken
        blockHeight
      }
    }
    blackjackResultEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        landId
        player
        result
        playerFinalValue
        dealerFinalValue
        payout
        bettingToken
        blockHeight
      }
    }
    baccaratRoundResultEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        landId
        player
        betType
        outcome
        won
        playerTotal
        bankerTotal
        payout
        bettingToken
        blockHeight
      }
    }
  }
`;

const GET_MY_ACTIVITY_QUERY = `
  query GetMyActivity($plantIds: [BigInt!], $landIds: [BigInt!], $playerAddress: String!, $cutoff: BigInt!) {
    attacks(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, OR: [{ attacker_in: $plantIds }, { winner_in: $plantIds }, { loser_in: $plantIds }]}) {
      items {
        __typename
        id
        timestamp
        attacker
        winner
        loser
        attackerName
        winnerName
        loserName
        scoresWon
      }
    }
    killeds(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, OR: [{ nftId_in: $plantIds }, { deadId_in: $plantIds }]}) {
      items {
        __typename
        id
        timestamp
        nftId
        deadId
        winnerName
        loserName
        reward
      }
    }
    mints(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, nftId_in: $plantIds }) {
      items {
        __typename
        id
        timestamp
        nftId
      }
    }
    playeds(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, nftId_in: $plantIds }) {
        items {
        __typename
        id
        timestamp
        nftId
        nftName
        gameName
        points
        timeExtension
        timeAdded
        leafAmount
        rewardIndex
        player
      }
    }
    itemConsumeds(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, nftId_in: $plantIds }) {
      items {
        __typename
        id
        timestamp
        nftId
        nftName
        giver
        itemId
      }
    }
    shopItemPurchaseds(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, nftId_in: $plantIds }) {
      items {
        __typename
        id
        timestamp
        nftId
        nftName
        giver
        itemId
      }
    }
    landTransferEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, OR: [{ from: $playerAddress }, { to: $playerAddress }]}) {
      items {
        __typename
        id
        timestamp
        from
        to
        tokenId
        blockHeight
      }
    }
    landMintedEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, to: $playerAddress }) {
      items {
        __typename
        id
        timestamp
        to
        tokenId
        mintPrice
        blockHeight
      }
    }
    landNameChangedEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, tokenId_in: $landIds }) {
      items {
        __typename
        id
        timestamp
        tokenId
        name
        blockHeight
      }
    }
    villageUpgradedWithLeafEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, landId_in: $landIds }) {
      items {
        __typename
        id
        timestamp
        landId
        buildingId
        upgradeCost
        xp
        blockHeight
      }
    }
    villageSpeedUpWithSeedEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, landId_in: $landIds }) {
      items {
        __typename
        id
        timestamp
        landId
        buildingId
        speedUpCost
        xp
        blockHeight
      }
    }
    townUpgradedWithLeafEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, landId_in: $landIds }) {
      items {
        __typename
        id
        timestamp
        landId
        buildingId
        upgradeCost
        xp
        blockHeight
      }
    }
    townSpeedUpWithSeedEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, landId_in: $landIds }) {
      items {
        __typename
        id
        timestamp
        landId
        buildingId
        speedUpCost
        xp
        blockHeight
      }
    }
    questStartedEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, landId_in: $landIds }) {
      items {
        __typename
        id
        timestamp
        landId
        farmerSlotId
        difficulty
        startBlock
        endBlock
        blockHeight
      }
    }
    questFinalizedEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, landId_in: $landIds }) {
      items {
        __typename
        id
        timestamp
        landId
        farmerSlotId
        player
        rewardType
        amount
        blockHeight
      }
    }
    villageProductionClaimedEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, landId_in: $landIds }) {
      items {
        __typename
        id
        timestamp
        landId
        buildingId
        blockHeight
      }
    }
    casinoBuiltEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, builder: $playerAddress }) {
        items {
          __typename
          id
          timestamp
          landId
          builder
          token
          cost
          blockHeight
        }
      }
      rouletteSpinResultEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, player: $playerAddress }) {
        items {
          __typename
          id
          timestamp
          landId
          player
          winningNumber
          won
          payout
          bettingToken
          blockHeight
        }
      }
      blackjackResultEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, player: $playerAddress }) {
        items {
          __typename
          id
          timestamp
          landId
          player
          result
          playerFinalValue
          dealerFinalValue
          payout
          bettingToken
          blockHeight
        }
      }
      baccaratRoundResultEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${MY_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER}, player: $playerAddress }) {
        items {
          __typename
          id
          timestamp
          landId
          player
          betType
          outcome
          won
          playerTotal
          bankerTotal
          payout
          bettingToken
          blockHeight
        }
      }
  }
`;

const GET_ALL_BARRACKS_ACTIVITY_QUERY = `
  query GetAllBarracksActivity($cutoff: BigInt!) {
    barracksBuiltEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        landId
        builder
        token
        cost
        blockHeight
      }
    }
    barracksRaidEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${ALL_ACTIVITY_LIMIT}, where: { ${ACTIVITY_WINDOW_FILTER} }) {
      items {
        __typename
        id
        timestamp
        raidId
        attackerLandId
        defenderLandId
        attackerWon
        blockHeight
      }
    }
  }
`;

const GET_MY_BARRACKS_ACTIVITY_QUERY = `
  query GetMyBarracksActivity($landIds: [BigInt!], $cutoff: BigInt!) {
    barracksBuiltEvents(
      orderBy: "timestamp",
      orderDirection: "desc",
      limit: ${MY_ACTIVITY_LIMIT},
      where: { ${ACTIVITY_WINDOW_FILTER}, landId_in: $landIds }
    ) {
      items {
        __typename
        id
        timestamp
        landId
        builder
        token
        cost
        blockHeight
      }
    }
    barracksRaidEvents(
      orderBy: "timestamp",
      orderDirection: "desc",
      limit: ${MY_ACTIVITY_LIMIT},
      where: { ${ACTIVITY_WINDOW_FILTER}, OR: [{ attackerLandId_in: $landIds }, { defenderLandId_in: $landIds }] }
    ) {
      items {
        __typename
        id
        timestamp
        raidId
        attackerLandId
        defenderLandId
        attackerWon
        blockHeight
      }
    }
  }
`;

async function fetchGraphQLData(query: string, variables?: Record<string, UntypedValue>) {
  return fetchIndexerGraphQL<UntypedValue>(query, variables, { revalidate: ALL_ACTIVITY_CACHE_SECONDS });
}

async function fetchOptionalBarracksActivity(cutoff: string): Promise<ActivityEvent[]> {
  try {
    const data = await fetchGraphQLData(GET_ALL_BARRACKS_ACTIVITY_QUERY, { cutoff });
    return [
      ...(data.barracksBuiltEvents?.items || []),
      ...(data.barracksRaidEvents?.items || []),
    ];
  } catch (error) {
    console.warn('Barracks activity is not available on the indexer yet:', error);
    return [];
  }
}

async function fetchOptionalMyBarracksActivity(landIds: string[], cutoff: string): Promise<ActivityEvent[]> {
  try {
    const data = await fetchGraphQLData(GET_MY_BARRACKS_ACTIVITY_QUERY, { landIds, cutoff });
    return [
      ...(data.barracksBuiltEvents?.items || []),
      ...(data.barracksRaidEvents?.items || []),
    ];
  } catch (error) {
    console.warn('Personal Barracks activity is not available on the indexer yet:', error);
    return [];
  }
}


export async function getAllActivity(): Promise<ActivityEvent[]> {
  const { cutoff, startsAt } = getActivityWindow();

  try {
    const [data, barracksEvents] = await Promise.all([
      fetchGraphQLData(GET_ALL_ACTIVITY_QUERY, { cutoff }),
      fetchOptionalBarracksActivity(cutoff),
    ]);

    const allActivities: ActivityEvent[] = [
      ...(data.attacks?.items || []),
      ...(data.killeds?.items || []),
      ...(data.mints?.items || []),
      ...(data.playeds?.items || []),
      ...(data.itemConsumeds?.items || []),
      ...(data.shopItemPurchaseds?.items || []),
      ...(data.landTransferEvents?.items || []),
      ...(data.landMintedEvents?.items || []),
      ...(data.landNameChangedEvents?.items || []),
      ...(data.villageUpgradedWithLeafEvents?.items || []),
      ...(data.villageSpeedUpWithSeedEvents?.items || []),
      ...(data.townUpgradedWithLeafEvents?.items || []),
      ...(data.townSpeedUpWithSeedEvents?.items || []),
      ...(data.questStartedEvents?.items || []),
      ...(data.questFinalizedEvents?.items || []),
      ...(data.villageProductionClaimedEvents?.items || []),
      ...(data.casinoBuiltEvents?.items || []),
      ...(data.rouletteSpinResultEvents?.items || []),
      ...(data.blackjackResultEvents?.items || []),
      ...(data.baccaratRoundResultEvents?.items || []),
      ...barracksEvents,
    ];

    const deduped = dedupePlayedEvents(allActivities);

    // Sort all activities by timestamp in descending order safely
    deduped.sort((a, b) => {
      const timeA = Number(a.timestamp);
      const timeB = Number(b.timestamp);
      if (isNaN(timeA) && isNaN(timeB)) return 0;
      if (isNaN(timeA)) return 1;
      if (isNaN(timeB)) return -1;
      return timeB - timeA;
    });

    // Filter to last 24 hours and return all activities
    return filterToWindow(deduped, startsAt);

  } catch (error) {
    console.error('Failed to fetch recent activity:', error);
    return []; // Return an empty array on error
  }
}

/**
 * A personal feed plus the asset IDs it was scoped to. Callers need those IDs to
 * tell an incoming attack from an outgoing one, and re-deriving them client-side
 * would mean a second round of contract reads.
 */
export type MyActivityFeed = {
  activities: ActivityEvent[];
  landIds: string[];
  plantIds: string[];
};

export async function getMyActivityFeed(address: string): Promise<MyActivityFeed> {
  const normalizedAddress = address.toLowerCase();

  const [plantsResult, landsResult] = await Promise.allSettled([
    getPlantsByOwner(normalizedAddress),
    getLandsByOwner(normalizedAddress),
  ]);

  if (plantsResult.status === 'rejected' && landsResult.status === 'rejected') {
    throw plantsResult.reason;
  }

  const userPlants = plantsResult.status === 'fulfilled' ? plantsResult.value : [];
  const plantIds = userPlants.map(p => p.id);

  const userLands = landsResult.status === 'fulfilled' ? landsResult.value : [];
  const landIds = userLands.map(l => l.tokenId.toString());

  const perspective = {
    landIds,
    plantIds: plantIds.map(id => id.toString()),
  };

  if (plantIds.length === 0 && landIds.length === 0) {
    return { activities: [], ...perspective };
  }

  const { cutoff, startsAt } = getActivityWindow();

  try {
    const [data, barracksEvents] = await Promise.all([
      fetchGraphQLData(GET_MY_ACTIVITY_QUERY, {
        cutoff,
        plantIds,
        landIds,
        playerAddress: normalizedAddress
      }),
      fetchOptionalMyBarracksActivity(landIds, cutoff),
    ]);

    const myActivities: ActivityEvent[] = [
      ...(data.attacks?.items || []),
      ...(data.killeds?.items || []),
      ...(data.mints?.items || []),
      ...(data.playeds?.items || []),
      ...(data.itemConsumeds?.items || []),
      ...(data.shopItemPurchaseds?.items || []),
      ...(data.landTransferEvents?.items || []),
      ...(data.landMintedEvents?.items || []),
      ...(data.landNameChangedEvents?.items || []),
      ...(data.villageUpgradedWithLeafEvents?.items || []),
      ...(data.villageSpeedUpWithSeedEvents?.items || []),
      ...(data.townUpgradedWithLeafEvents?.items || []),
      ...(data.townSpeedUpWithSeedEvents?.items || []),
      ...(data.questStartedEvents?.items || []),
      ...(data.questFinalizedEvents?.items || []),
      ...(data.villageProductionClaimedEvents?.items || []),
      ...(data.casinoBuiltEvents?.items || []),
      ...(data.rouletteSpinResultEvents?.items || []),
      ...(data.blackjackResultEvents?.items || []),
      ...(data.baccaratRoundResultEvents?.items || []),
      ...barracksEvents,
    ];

    const deduped = dedupePlayedEvents(myActivities);

    // Sort all activities by timestamp in descending order safely
    deduped.sort((a, b) => {
      const timeA = Number(a.timestamp);
      const timeB = Number(b.timestamp);
      if (isNaN(timeA) && isNaN(timeB)) return 0;
      if (isNaN(timeA)) return 1;
      if (isNaN(timeB)) return -1;
      return timeB - timeA;
    });

    return { activities: filterToWindow(deduped, startsAt), ...perspective };

  } catch (error) {
    console.error('Failed to fetch personal activity:', error);
    return { activities: [], ...perspective };
  }
}

export async function getMyActivity(address: string): Promise<ActivityEvent[]> {
  return (await getMyActivityFeed(address)).activities;
}

export const getCachedAllActivity = unstable_cache(
  async () => getAllActivity(),
  ['activity:all:v1'],
  { revalidate: ALL_ACTIVITY_CACHE_SECONDS, tags: ['activity:all'] },
);

export function getCachedMyActivityFeed(address: string): Promise<MyActivityFeed> {
  const normalizedAddress = address.toLowerCase();
  const cachedGetter = unstable_cache(
    async () => getMyActivityFeed(normalizedAddress),
    ['activity:my:v2', normalizedAddress],
    {
      revalidate: MY_ACTIVITY_CACHE_SECONDS,
      tags: [`activity:${normalizedAddress}`],
    },
  );

  return cachedGetter().catch((error) => {
    if (isMissingIncrementalCacheError(error)) {
      return getMyActivityFeed(normalizedAddress);
    }
    throw error;
  });
}

export async function getCachedMyActivity(address: string): Promise<ActivityEvent[]> {
  return (await getCachedMyActivityFeed(address)).activities;
}
