import type { ActivityEvent, AttackEvent, PlayedEvent } from './types';
import { ITEM_ICONS } from './constants';
import { activityInteger, blackjackActivityOutcome } from './activity-presentation';
import { formatDuration, formatQuestReward, formatScore, formatTokenAmount, getBuildingIcon, getBuildingName, getQuestDifficulty } from './utils';

export type ActivityItemNames = Record<string, string>;
export type ActivitySource = { kind: 'plant' | 'land'; id: string | null; name?: string };

/** Missing or damaged identity is not an asset number; zero remains a valid ID. */
export function getActivityAssetId(value: unknown): string | null {
  if (typeof value === 'bigint') return value >= BigInt('0') ? value.toString() : null;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  return BigInt(value.trim()).toString();
}

export function getActivityAttackOutcome(event: AttackEvent): boolean | null {
  const attacker = getActivityAssetId(event.attacker);
  const winner = getActivityAssetId(event.winner);
  return attacker === null || winner === null ? null : attacker === winner;
}
export const ACTIVITY_GAME_NAMES: Record<string, string> = { SpinGameV2: 'SpinLeaf', spinGameV2: 'SpinLeaf' };

/** Historic shop item 1 represents Fence across its contract-era names. */
export function getActivityItem(id: string, type: 'garden' | 'shop', names?: ActivityItemNames) {
  const name = type === 'shop' && id === '1' ? 'Fence' : names?.[id] || `Item #${id}`;
  return { name, icon: ITEM_ICONS[name.toLowerCase()] || '/icons/BEE.png' };
}

export function getActivityIcon(event: ActivityEvent, shop?: ActivityItemNames, garden?: ActivityItemNames) {
  const building = (town: boolean, id: number) => { const name = getBuildingName(id, town); return { icon: getBuildingIcon(name), name }; };
  switch (event.__typename) {
    case 'ItemConsumed': return getActivityItem(event.itemId, 'garden', garden);
    case 'ShopItemPurchased': return getActivityItem(event.itemId, 'shop', shop);
    case 'VillageUpgradedWithLeafEvent': case 'VillageSpeedUpWithSeedEvent': case 'VillageProductionClaimedEvent': return building(false, event.buildingId);
    case 'TownUpgradedWithLeafEvent': case 'TownSpeedUpWithSeedEvent': return building(true, event.buildingId);
    case 'Attack': {
      const outcome = getActivityAttackOutcome(event);
      return { icon: outcome === null ? '/icons/attackpwr.svg' : outcome ? '/icons/Attackwon.png' : '/icons/Attacklost.png', name: 'Attack' };
    }
    case 'BarracksRaidEvent': return { icon: event.attackerWon ? '/icons/Attackwon.png' : '/icons/Attacklost.png', name: 'Raid' };
    case 'Killed': return { icon: '/icons/skull.png', name: 'Star collected' };
    case 'Mint': return { icon: '/icons/plant1.svg', name: 'Plant minted' };
    case 'Played': return { icon: '/icons/GAME.png', name: 'Arcade' };
    case 'WarehouseAssignmentEvent': case 'LandTransferEvent': return { icon: getBuildingIcon('Warehouse'), name: 'Warehouse' };
    case 'LandMintedEvent': case 'LandNameChangedEvent': case 'QuestStartedEvent': case 'QuestFinalizedEvent': return { icon: getBuildingIcon('Farmer House'), name: 'Land' };
    case 'BarracksBuiltEvent': return { icon: getBuildingIcon('Barracks'), name: 'Barracks' };
    case 'CasinoBuiltEvent': case 'RouletteSpinResultEvent': case 'BlackjackResultEvent': case 'BaccaratRoundResultEvent': return { icon: getBuildingIcon('Casino'), name: 'Casino' };
  }
}

function amount(value: unknown, kind: 'points' | 'lifetime') {
  const parsed = activityInteger(value);
  if (parsed === null || !Number.isFinite(Number(parsed))) return 'Amount unavailable';
  return kind === 'points' ? `${formatScore(Number(parsed))} PTS` : `${formatDuration(Number(parsed))} lifetime`;
}

export function getPlayedRewardSummary(event: PlayedEvent): string {
  const points = activityInteger(event.points ?? '0');
  const lifetime = activityInteger(event.timeAdded ?? event.timeExtension ?? '0');
  const leaf = activityInteger(event.leafAmount ?? '0');
  const parts: string[] = [];
  const pointsKnown = points !== null && Number.isFinite(Number(points));
  const lifetimeKnown = lifetime !== null && Number.isFinite(Number(lifetime));
  if (pointsKnown && points !== BigInt('0')) parts.push(`${points > BigInt('0') ? '+' : '-'}${formatScore(Number(points < BigInt('0') ? -points : points))} PTS`);
  if (lifetimeKnown && lifetime !== BigInt('0')) parts.push(`${lifetime > BigInt('0') ? '+' : '-'}${formatDuration(Number(lifetime < BigInt('0') ? -lifetime : lifetime))} lifetime`);
  if (leaf !== null && leaf !== BigInt('0')) parts.push(`${leaf > BigInt('0') ? '+' : ''}${formatTokenAmount(leaf)} LEAF`);
  if (!pointsKnown || !lifetimeKnown || leaf === null) parts.push('Some reward details are unavailable');
  return parts.join(' · ') || 'no reward this time';
}

export function getActivityHeadline(event: ActivityEvent, shop?: ActivityItemNames, garden?: ActivityItemNames): string {
  switch (event.__typename) {
    case 'Attack': {
      const outcome = getActivityAttackOutcome(event);
      return outcome === null ? 'Attack outcome unavailable' : `${outcome ? 'Won' : 'Lost'} ${amount(event.scoresWon, 'points')}`;
    }
    case 'Killed': return 'Collected a star';
    case 'Mint': return 'Plant minted';
    case 'Played': return `${ACTIVITY_GAME_NAMES[event.gameName] ?? event.gameName}: ${getPlayedRewardSummary(event)}`;
    case 'ItemConsumed': return `Used ${getActivityItem(event.itemId, 'garden', garden).name}`;
    case 'ShopItemPurchased': return `Bought ${getActivityItem(event.itemId, 'shop', shop).name}`;
    case 'LandTransferEvent': return 'Land transferred';
    case 'LandMintedEvent': return 'Land minted';
    case 'LandNameChangedEvent': return 'Land renamed';
    case 'VillageUpgradedWithLeafEvent': return `Upgrading ${getBuildingName(event.buildingId, false)}`;
    case 'TownUpgradedWithLeafEvent': return `Upgrading ${getBuildingName(event.buildingId, true)}`;
    case 'VillageSpeedUpWithSeedEvent': case 'TownSpeedUpWithSeedEvent': return 'Construction sped up';
    case 'QuestStartedEvent': return `${getQuestDifficulty(event.difficulty)} quest started`;
    case 'QuestFinalizedEvent': return `Quest reward: ${formatQuestReward(event.rewardType, event.amount)}`;
    case 'VillageProductionClaimedEvent': return `${getBuildingName(event.buildingId, false)} production claimed`;
    case 'BarracksBuiltEvent': return 'Barracks built';
    case 'BarracksRaidEvent': return event.attackerWon ? 'Raid won' : 'Raid lost';
    case 'CasinoBuiltEvent': return 'Casino built';
    case 'WarehouseAssignmentEvent': {
      const plantId = getActivityAssetId(event.plantId);
      return `${amount(event.amount, event.resource)}${plantId === null ? ' assigned' : ` to Plant #${plantId}`}`;
    }
    case 'RouletteSpinResultEvent': return event.won ? 'Roulette won' : 'Roulette lost';
    case 'BlackjackResultEvent': return `Blackjack ${blackjackActivityOutcome(Number(event.result)).label}`;
    case 'BaccaratRoundResultEvent': return event.won ? 'Baccarat won' : (activityInteger(event.payout) ?? BigInt('0')) > BigInt('0') ? 'Baccarat bet returned' : 'Baccarat lost';
  }
}

export function getActivitySource(event: ActivityEvent): ActivitySource {
  if ('landId' in event) return { kind: 'land', id: getActivityAssetId(event.landId) };
  if ('attackerLandId' in event) return { kind: 'land', id: getActivityAssetId(event.attackerLandId) };
  if ('tokenId' in event) return { kind: 'land', id: getActivityAssetId(event.tokenId) };
  const name = 'nftName' in event && typeof event.nftName === 'string' ? event.nftName.trim() : undefined;
  return { kind: 'plant', id: getActivityAssetId('attacker' in event ? event.attacker : event.nftId), name: name || undefined };
}
