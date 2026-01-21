import { ActivityEvent, PlayedEvent } from './types';
import { getPlantsByOwner, getLandsByOwner } from './contracts';

// Updated to use unified indexer endpoint
const API_URL = process.env.NEXT_PUBLIC_PONDER_API_URL || 'https://api.mini.pixotchi.tech/graphql';

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
  }
`;


export async function getAllActivity(): Promise<ActivityEvent[]> {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: GET_ALL_ACTIVITY_QUERY }),
      next: { revalidate: 60 } // Revalidate every 60 seconds
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.statusText}`);
    }

    const json = await response.json();

    if (json.errors) {
      console.error('GraphQL Errors:', json.errors);
      throw new Error('Error fetching activity data');
    }

    const { data } = json;

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
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: GET_MY_ACTIVITY_QUERY,
        variables: {
          plantIds,
          landIds,
          playerAddress: address
        }
      }),
      next: { revalidate: 60 }
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.statusText}`);
    }

    const json = await response.json();

    if (json.errors) {
      console.error('GraphQL Errors:', json.errors);
      throw new Error('Error fetching personal activity data');
    }

    const { data } = json;

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