import 'server-only';

import { unstable_cache } from 'next/cache';
import { ActivityEvent, PlayedEvent } from './types';
import { getPlantsByOwner, getLandsByOwner } from './contracts';
import { fetchIndexerGraphQL } from './indexer-client';

const ALL_ACTIVITY_CACHE_SECONDS = 15;
const MY_ACTIVITY_CACHE_SECONDS = 30;

// Filter activities to last 24 hours
function filterLast24Hours(activities: ActivityEvent[]): ActivityEvent[] {
  const now = Math.floor(Date.now() / 1000); // Current timestamp in seconds
  const twentyFourHoursAgo = now - (24 * 60 * 60); // 24 hours ago in seconds

  return activities.filter(activity => {
    const activityTimestamp = Number(activity.timestamp);
    return activityTimestamp >= twentyFourHoursAgo;
  });
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
  query GetAllActivity {
    attacks(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
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
    killeds(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
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
    mints(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
      items {
        __typename
        id
        timestamp
        nftId
      }
    }
    playeds(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
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
    itemConsumeds(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
      items {
        __typename
        id
        timestamp
        nftName
        giver
        itemId
      }
    }
    shopItemPurchaseds(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
      items {
        __typename
        id
        timestamp
        nftName
        giver
        itemId
      }
    }
    landTransferEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
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
    landMintedEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
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
    landNameChangedEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
      items {
        __typename
        id
        timestamp
        tokenId
        name
        blockHeight
      }
    }
    villageUpgradedWithLeafEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
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
    villageSpeedUpWithSeedEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
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
    townUpgradedWithLeafEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
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
    townSpeedUpWithSeedEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
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
    questStartedEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
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
    questFinalizedEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
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
    villageProductionClaimedEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
      items {
        __typename
        id
        timestamp
        landId
        buildingId
        blockHeight
      }
    }
    casinoBuiltEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
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
    rouletteSpinResultEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
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
    blackjackResultEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
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
  }
`;

const GET_MY_ACTIVITY_QUERY = `
  query GetMyActivity($plantIds: [BigInt!], $landIds: [BigInt!], $playerAddress: String!) {
    attacks(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { OR: [{ attacker_in: $plantIds }, { loser_in: $plantIds }]}) {
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
    killeds(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { OR: [{ nftId_in: $plantIds }, { deadId_in: $plantIds }]}) {
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
    mints(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { nftId_in: $plantIds }) {
      items {
        __typename
        id
        timestamp
        nftId
      }
    }
    playeds(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { nftId_in: $plantIds }) {
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
    itemConsumeds(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { nftId_in: $plantIds }) {
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
    shopItemPurchaseds(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { nftId_in: $plantIds }) {
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
    landTransferEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { OR: [{ from: $playerAddress }, { to: $playerAddress }]}) {
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
    landMintedEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { to: $playerAddress }) {
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
    landNameChangedEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { tokenId_in: $landIds }) {
      items {
        __typename
        id
        timestamp
        tokenId
        name
        blockHeight
      }
    }
    villageUpgradedWithLeafEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { landId_in: $landIds }) {
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
    villageSpeedUpWithSeedEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { landId_in: $landIds }) {
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
    townUpgradedWithLeafEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { landId_in: $landIds }) {
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
    townSpeedUpWithSeedEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { landId_in: $landIds }) {
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
    questStartedEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { landId_in: $landIds }) {
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
    questFinalizedEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { player: $playerAddress }) {
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
    villageProductionClaimedEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { landId_in: $landIds }) {
      items {
        __typename
        id
        timestamp
        landId
        buildingId
        blockHeight
      }
    }
    casinoBuiltEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { builder: $playerAddress }) {
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
      rouletteSpinResultEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { player: $playerAddress }) {
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
      blackjackResultEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100, where: { player: $playerAddress }) {
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
  }
`;

const GET_ALL_BARRACKS_ACTIVITY_QUERY = `
  query GetAllBarracksActivity {
    barracksBuiltEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
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
    barracksRaidEvents(orderBy: "timestamp", orderDirection: "desc", limit: 100) {
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
  query GetMyBarracksActivity($landIds: [BigInt!]) {
    barracksBuiltEvents(
      orderBy: "timestamp",
      orderDirection: "desc",
      limit: 100,
      where: { landId_in: $landIds }
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
      limit: 100,
      where: { OR: [{ attackerLandId_in: $landIds }, { defenderLandId_in: $landIds }] }
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

async function fetchGraphQLData(query: string, variables?: Record<string, unknown>) {
  return fetchIndexerGraphQL<any>(query, variables, { revalidate: ALL_ACTIVITY_CACHE_SECONDS });
}

async function fetchOptionalBarracksActivity(): Promise<ActivityEvent[]> {
  try {
    const data = await fetchGraphQLData(GET_ALL_BARRACKS_ACTIVITY_QUERY);
    return [
      ...(data.barracksBuiltEvents?.items || []),
      ...(data.barracksRaidEvents?.items || []),
    ];
  } catch (error) {
    console.warn('Barracks activity is not available on the indexer yet:', error);
    return [];
  }
}

async function fetchOptionalMyBarracksActivity(landIds: string[]): Promise<ActivityEvent[]> {
  try {
    const data = await fetchGraphQLData(GET_MY_BARRACKS_ACTIVITY_QUERY, { landIds });
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
  try {
    const [data, barracksEvents] = await Promise.all([
      fetchGraphQLData(GET_ALL_ACTIVITY_QUERY),
      fetchOptionalBarracksActivity(),
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
    return filterLast24Hours(deduped);

  } catch (error) {
    console.error('Failed to fetch recent activity:', error);
    return []; // Return an empty array on error
  }
}

export async function getMyActivity(address: string): Promise<ActivityEvent[]> {
  const userPlants = await getPlantsByOwner(address);
  const plantIds = userPlants.map(p => p.id);

  const userLands = await getLandsByOwner(address);
  const landIds = userLands.map(l => l.tokenId.toString());

  if (plantIds.length === 0 && landIds.length === 0) {
    return [];
  }

  try {
    const [data, barracksEvents] = await Promise.all([
      fetchGraphQLData(GET_MY_ACTIVITY_QUERY, {
        plantIds,
        landIds,
        playerAddress: address
      }),
      fetchOptionalMyBarracksActivity(landIds),
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

    return filterLast24Hours(deduped);

  } catch (error) {
    console.error('Failed to fetch personal activity:', error);
    return [];
  }
} 

export const getCachedAllActivity = unstable_cache(
  async () => getAllActivity(),
  ['activity:all:v1'],
  { revalidate: ALL_ACTIVITY_CACHE_SECONDS, tags: ['activity:all'] },
);

export function getCachedMyActivity(address: string): Promise<ActivityEvent[]> {
  const normalizedAddress = address.toLowerCase();
  const cachedGetter = unstable_cache(
    async () => getMyActivity(normalizedAddress),
    ['activity:my:v1', normalizedAddress],
    {
      revalidate: MY_ACTIVITY_CACHE_SECONDS,
      tags: [`activity:${normalizedAddress}`],
    },
  );

  return cachedGetter();
}
