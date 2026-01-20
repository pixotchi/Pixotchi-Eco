"use client";

import React from 'react';
import { AttackEvent, KilledEvent, MintEvent, PlayedEvent, ItemConsumedEvent, ShopItemPurchasedEvent, ActivityEvent, BundledItemConsumedEvent } from '@/lib/types';
import { formatAddress, formatTokenAmount, formatScore, formatDuration } from '@/lib/utils';
import { Sword, Skull, Sparkles, Gamepad2, Apple, ShoppingCart, HelpCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import Image from 'next/image';
import { ITEM_ICONS } from '@/lib/constants';
import { LAND_EVENT_ICONS } from '@/lib/constants';

const SHOP_ITEM_OVERRIDES: Record<string, { name: string; icon: string }> = {
  '1': { name: 'Fence', icon: '/icons/Fence.png' },
};
import { getBuildingName, getQuestDifficulty, getQuestReward, formatQuestReward } from '@/lib/utils';
import {
  LandTransferEvent,
  LandMintedEvent,
  LandNameChangedEvent,
  VillageUpgradedWithLeafEvent,
  VillageSpeedUpWithSeedEvent,
  TownUpgradedWithLeafEvent,
  TownSpeedUpWithSeedEvent,
  QuestStartedEvent,
  QuestFinalizedEvent,
  VillageProductionClaimedEvent,
  CasinoBuiltEvent,
  RouletteSpinResultEvent
} from '@/lib/types';

const TimeAgo = React.memo(({ timestamp }: { timestamp: string }) => {
  const timeAgo = React.useMemo(() => {
    const date = new Date(parseInt(timestamp) * 1000);
    return formatDistanceToNow(date, { addSuffix: true });
  }, [timestamp]);

  return <span className="text-xs text-muted-foreground">{timeAgo}</span>;
});

const EventIcon = React.memo(({
  type,
  event,
  shopItemMap,
  gardenItemMap
}: {
  type: ActivityEvent['__typename'],
  event?: any,
  shopItemMap?: { [key: string]: string },
  gardenItemMap?: { [key: string]: string }
}) => {
  const iconClass = "w-6 h-6 object-contain";

  const { iconSrc, altText } = React.useMemo(() => {
    switch (type) {
      case 'Attack':
        if (event && event.attacker === event.winner) {
          return { iconSrc: "/icons/Attackwon.svg", altText: "Attack Won" };
        } else {
          return { iconSrc: "/icons/Attacklost.svg", altText: "Attack Lost" };
        }
      case 'Killed':
        return { iconSrc: "/icons/skull.png", altText: "Kill" };
      case 'Mint':
        return { iconSrc: "/icons/plant1.svg", altText: "New Plant" };
      case 'Played':
        return { iconSrc: "/icons/GAME.png", altText: "Game Played" };
      case 'ItemConsumed':
        if (event && gardenItemMap) {
          const itemName = gardenItemMap[event.itemId];
          const itemIcon = ITEM_ICONS[itemName?.toLowerCase()] || '/icons/BEE.png';
          return { iconSrc: itemIcon, altText: itemName || 'Garden Item' };
        }
        return { iconSrc: "/icons/BEE.png", altText: "Item Consumed" };
      case 'ShopItemPurchased':
        if (event && shopItemMap) {
          const override = SHOP_ITEM_OVERRIDES[event.itemId];
          const itemName = override?.name || shopItemMap[event.itemId];
          const itemIcon = override?.icon || ITEM_ICONS[itemName?.toLowerCase()] || '/icons/BEE.png';
          return { iconSrc: itemIcon, altText: itemName || override?.name || 'Shop Item' };
        }
        return { iconSrc: "/icons/BEE.png", altText: "Shop Item" };
      // Land Event Icons
      case 'LandTransferEvent':
        return { iconSrc: "/icons/ware-house.svg", altText: "Land Transfer" };
      case 'LandMintedEvent':
        return { iconSrc: "/icons/farmer-house.svg", altText: "Land Minted" };
      case 'LandNameChangedEvent':
        return { iconSrc: "/icons/farmer-house.svg", altText: "Land Renamed" };
      case 'VillageUpgradedWithLeafEvent':
      case 'VillageSpeedUpWithSeedEvent':
        if (event && event.buildingId !== undefined) {
          const buildingName = getBuildingName(event.buildingId, false);
          const buildingIcons: { [key: string]: string } = {
            "Solar Panels": "/icons/solar-panels.svg",
            "Soil Factory": "/icons/soil-factory.svg",
            "Bee Farm": "/icons/bee-house.svg"
          };
          return { iconSrc: buildingIcons[buildingName] || "/icons/solar-panels.svg", altText: buildingName };
        }
        return { iconSrc: "/icons/solar-panels.svg", altText: "Village Building" };
      case 'TownUpgradedWithLeafEvent':
      case 'TownSpeedUpWithSeedEvent':
        if (event && event.buildingId !== undefined) {
          const buildingName = getBuildingName(event.buildingId, true);
          const buildingIcons: { [key: string]: string } = {
            "Stake House": "/icons/stake-house.svg",
            "Ware House": "/icons/ware-house.svg",
            "Marketplace": "/icons/marketplace.svg",
            "Farmer House": "/icons/farmer-house.svg"
          };
          return { iconSrc: buildingIcons[buildingName] || "/icons/marketplace.svg", altText: buildingName };
        }
        return { iconSrc: "/icons/marketplace.svg", altText: "Town Building" };
      case 'QuestStartedEvent':
      case 'QuestFinalizedEvent':
        return { iconSrc: "/icons/stake-house.svg", altText: "Quest" };
      case 'VillageProductionClaimedEvent':
        if (event && event.buildingId !== undefined) {
          const buildingName = getBuildingName(event.buildingId, false);
          const buildingIcons: { [key: string]: string } = {
            "Solar Panels": "/icons/solar-panels.svg",
            "Soil Factory": "/icons/soil-factory.svg",
            "Bee Farm": "/icons/bee-house.svg"
          };
          return { iconSrc: buildingIcons[buildingName] || "/icons/bee-house.svg", altText: buildingName };
        }
        return { iconSrc: "/icons/bee-house.svg", altText: "Production" };
      case 'CasinoBuiltEvent':
        return { iconSrc: "/icons/stake-house.svg", altText: "Casino Built" };
      case 'RouletteSpinResultEvent':
        return { iconSrc: "/icons/casino.svg", altText: "Roulette Win" };
      default:
        return { iconSrc: null, altText: "Unknown Event" };
    }
  }, [type, event, shopItemMap, gardenItemMap]);

  if (!iconSrc) {
    return <HelpCircle className="w-6 h-6 text-muted-foreground" />;
  }

  return (
    <Image
      src={iconSrc}
      alt={altText}
      width={24}
      height={24}
      className={iconClass}
      loading="lazy"
      quality={80}
      sizes="24px"
    />
  );
});

const YouBadge = () => (
  <span className="ml-1 text-xs font-semibold text-blue-500">(You)</span>
);

const PlantName = ({ name, id, isYou }: { name?: string, id: string, isYou: boolean }) => (
  <span className={`font-bold ${isYou ? 'text-blue-500' : ''}`}>
    {name || `Plant #${id}`}
    {isYou && <YouBadge />}
  </span>
);

const LandName = ({ landId, isYou }: { landId: string, isYou: boolean }) => (
  <span className={`font-bold ${isYou ? 'text-blue-500' : ''}`}>
    Land #{landId}
    {isYou && <YouBadge />}
  </span>
);

const PlayerName = ({ address, isYou }: { address: string, isYou: boolean }) => (
  <>
    {isYou && <YouBadge />}
    <span className="font-bold">{isYou ? "You" : formatAddress(address)}</span>
  </>
);

const EventWrapper = ({
  children,
  event,
  shopItemMap,
  gardenItemMap
}: {
  children: React.ReactNode,
  event: ActivityEvent,
  shopItemMap?: { [key: string]: string },
  gardenItemMap?: { [key: string]: string }
}) => (
  <div className="flex items-start space-x-3 py-2">
    <div className="mt-1 flex-shrink-0">
      <EventIcon
        type={event.__typename}
        event={event}
        shopItemMap={shopItemMap}
        gardenItemMap={gardenItemMap}
      />
    </div>
    <div className="flex-1">
      {children}
      <TimeAgo timestamp={event.timestamp} />
    </div>
  </div>
);

const GAME_NAME_ALIASES: Record<string, string> = {
  SpinGameV2: "SpinLeaf",
  "spinGameV2": "SpinLeaf",
};

export const AttackEventRenderer = React.memo(({
  event,
  userAddress,
  shopItemMap,
  gardenItemMap
}: {
  event: AttackEvent,
  userAddress?: string | null,
  shopItemMap?: { [key: string]: string },
  gardenItemMap?: { [key: string]: string }
}) => {
  const {
    attackerIsWinner,
    opponent,
    isAttackerYou,
    isOpponentYou,
    formattedScore
  } = React.useMemo(() => {
    const winner = event.attacker === event.winner;
    const opp = winner
      ? { id: event.loser, name: event.loserName }
      : { id: event.winner, name: event.winnerName };

    const attackerYou = userAddress && event.attackerName.toLowerCase() === userAddress.toLowerCase();
    const opponentYou = userAddress && opp.name?.toLowerCase() === userAddress.toLowerCase();
    const score = formatScore(parseInt(event.scoresWon));

    return {
      attackerIsWinner: winner,
      opponent: opp,
      isAttackerYou: attackerYou,
      isOpponentYou: opponentYou,
      formattedScore: score
    };
  }, [event, userAddress]);

  return (
    <EventWrapper event={event} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap}>
      <p className="text-sm">
        <PlantName name={event.attackerName} id={event.attacker} isYou={!!isAttackerYou} />
        {' attacked '}
        <PlantName name={opponent.name} id={opponent.id} isYou={!!isOpponentYou} />
        {attackerIsWinner ? ' and won ' : ' and lost '}
        <span className="font-semibold text-value">{formattedScore}</span>
        {' PTS!'}
      </p>
    </EventWrapper>
  );
});

export const KilledEventRenderer = ({ event, userAddress, shopItemMap, gardenItemMap }: { event: KilledEvent, userAddress?: string | null, shopItemMap?: { [key: string]: string }, gardenItemMap?: { [key: string]: string } }) => {
  const isWinnerYou = userAddress && event.winnerName.toLowerCase() === userAddress.toLowerCase();
  const isLoserYou = userAddress && event.loserName.toLowerCase() === userAddress.toLowerCase();

  return (
    <EventWrapper event={event} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap}>
      <p className="text-sm">
        <PlantName name={event.winnerName} id={event.nftId} isYou={!!isWinnerYou} /> killed <PlantName name={event.loserName} id={event.deadId} isYou={!!isLoserYou} /> and claimed a star.
      </p>
    </EventWrapper>
  );
};

export const MintEventRenderer = ({ event, shopItemMap, gardenItemMap }: { event: MintEvent, shopItemMap?: { [key: string]: string }, gardenItemMap?: { [key: string]: string } }) => (
  <EventWrapper event={event} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap}>
    <p className="text-sm">
      A new Pixotchi, <span className="font-bold">Plant #{event.nftId}</span>, was born!
    </p>
  </EventWrapper>
);

export const PlayedEventRenderer = ({ event, userAddress, shopItemMap, gardenItemMap }: { event: PlayedEvent, userAddress?: string | null, shopItemMap?: { [key: string]: string }, gardenItemMap?: { [key: string]: string } }) => {
  const isYou = userAddress && event.nftName.toLowerCase() === userAddress.toLowerCase();
  const displayGameName = GAME_NAME_ALIASES[event.gameName] ?? event.gameName;
  const pointsDelta = Number(event.points ?? "0");
  const timeBonusSeconds = event.timeAdded ?? event.timeExtension ? Number(event.timeAdded ?? event.timeExtension ?? "0") : 0;
  const leafReward = event.leafAmount ? BigInt(String(event.leafAmount)) : BigInt("0");

  const rewardChips: React.ReactNode[] = [];

  if (pointsDelta !== 0) {
    rewardChips.push(
      <span key="points" className="font-semibold text-value">
        {`${pointsDelta > 0 ? '+' : ''}${formatScore(Math.abs(pointsDelta))} PTS`}
      </span>
    );
  }

  if (timeBonusSeconds !== 0) {
    rewardChips.push(
      <span key="tod" className="font-semibold text-value">
        {`${timeBonusSeconds > 0 ? '+' : ''}${formatDuration(Math.abs(timeBonusSeconds))} TOD`}
      </span>
    );
  }

  if (leafReward !== BigInt("0")) {
    rewardChips.push(
      <span key="leaf" className="font-semibold text-value">
        {`${leafReward > BigInt("0") ? '+' : ''}${formatTokenAmount(leafReward)} LEAF`}
      </span>
    );
  }

  let rewardSummary: React.ReactNode = <span className="text-muted-foreground">no reward this time</span>;

  if (rewardChips.length > 0) {
    rewardSummary = rewardChips.reduce<React.ReactNode[]>((acc, chip, index) => {
      if (index === 0) return [chip];
      acc.push(
        <span key={`separator-${index}`} className="px-1 text-muted-foreground">
          •
        </span>
      );
      acc.push(chip);
      return acc;
    }, []);
  }

  return (
    <EventWrapper event={event} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap}>
      <p className="text-sm">
        <PlantName name={event.nftName} id={event.nftId} isYou={!!isYou} /> played <span className="font-semibold">{displayGameName}</span> and won {rewardSummary}.
      </p>
    </EventWrapper>
  );
};

export const ItemConsumedEventRenderer = ({ event, userAddress, itemMap, shopItemMap, gardenItemMap }: { event: BundledItemConsumedEvent, userAddress?: string | null, itemMap: { [key: string]: string }, shopItemMap?: { [key: string]: string }, gardenItemMap?: { [key: string]: string } }) => {
  const isYou = userAddress && event.nftName.toLowerCase() === userAddress.toLowerCase();
  const itemName = itemMap[event.itemId] || `Item #${event.itemId}`;
  const quantityText = event.quantity > 1 ? `${event.quantity}x ` : '';

  return (
    <EventWrapper event={event} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap}>
      <p className="text-sm">
        <PlantName name={event.nftName} id={event.nftId} isYou={!!isYou} /> consumed <span className="font-semibold">{quantityText}{itemName}</span>.
      </p>
    </EventWrapper>
  );
};

export const ShopItemPurchasedEventRenderer = ({ event, userAddress, itemMap, shopItemMap, gardenItemMap }: { event: ShopItemPurchasedEvent, userAddress?: string | null, itemMap: { [key: string]: string }, shopItemMap?: { [key: string]: string }, gardenItemMap?: { [key: string]: string } }) => {
  const isYou = userAddress && event.nftName.toLowerCase() === userAddress.toLowerCase();
  const override = SHOP_ITEM_OVERRIDES[event.itemId];
  const itemName = override?.name || itemMap[event.itemId] || `Item #${event.itemId}`;
  return (
    <EventWrapper event={event} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap}>
      <p className="text-sm">
        <PlantName name={event.nftName} id={event.nftId} isYou={!!isYou} /> bought <span className="font-semibold">{itemName}</span> from the shop.
      </p>
    </EventWrapper>
  );
};

// Land Event Renderers
export const LandTransferEventRenderer = ({ event, userAddress }: { event: LandTransferEvent, userAddress?: string | null }) => {
  const isFromYou = userAddress && event.from.toLowerCase() === userAddress.toLowerCase();
  const isToYou = userAddress && event.to.toLowerCase() === userAddress.toLowerCase();

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <LandName landId={event.tokenId} isYou={!!isToYou} /> was transferred{isFromYou ? " from you" : ""}{isToYou ? " to you" : ""}.
      </p>
    </EventWrapper>
  );
};

export const LandMintedEventRenderer = ({ event, userAddress }: { event: LandMintedEvent, userAddress?: string | null }) => {
  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        A new land, <span className="font-bold">Land #{event.tokenId}</span>, was claimed!
      </p>
    </EventWrapper>
  );
};

export const LandNameChangedEventRenderer = ({ event }: { event: LandNameChangedEvent }) => (
  <EventWrapper event={event}>
    <p className="text-sm">
      Land #{event.tokenId} was renamed to "<span className="font-semibold">{event.name}</span>".
    </p>
  </EventWrapper>
);

export const VillageUpgradeEventRenderer = ({ event, userAddress }: { event: VillageUpgradedWithLeafEvent, userAddress?: string | null }) => {
  const buildingName = getBuildingName(event.buildingId, false);

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <span className="font-bold">Land #{event.landId}</span> started upgrading {buildingName}.
      </p>
    </EventWrapper>
  );
};

export const VillageSpeedUpEventRenderer = ({ event, userAddress }: { event: VillageSpeedUpWithSeedEvent, userAddress?: string | null }) => {
  const buildingName = getBuildingName(event.buildingId, false);

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <span className="font-bold">Land #{event.landId}</span> sped up {buildingName} construction.
      </p>
    </EventWrapper>
  );
};

export const TownUpgradeEventRenderer = ({ event, userAddress }: { event: TownUpgradedWithLeafEvent, userAddress?: string | null }) => {
  const buildingName = getBuildingName(event.buildingId, true);

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <span className="font-bold">Land #{event.landId}</span> started upgrading {buildingName}.
      </p>
    </EventWrapper>
  );
};

export const TownSpeedUpEventRenderer = ({ event, userAddress }: { event: TownSpeedUpWithSeedEvent, userAddress?: string | null }) => {
  const buildingName = getBuildingName(event.buildingId, true);

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <span className="font-bold">Land #{event.landId}</span> sped up {buildingName} construction.
      </p>
    </EventWrapper>
  );
};

export const QuestStartedEventRenderer = ({ event }: { event: QuestStartedEvent }) => {
  const difficulty = getQuestDifficulty(event.difficulty);

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <span className="font-bold">Land #{event.landId}</span> started a {difficulty} quest.
      </p>
    </EventWrapper>
  );
};

export const QuestFinalizedEventRenderer = ({ event, userAddress }: { event: QuestFinalizedEvent, userAddress?: string | null }) => {
  const reward = formatQuestReward(event.rewardType, event.amount);

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <span className="font-bold">Land #{event.landId}</span> completed a quest and earned <span className="font-semibold text-value">{reward}</span>.
      </p>
    </EventWrapper>
  );
};

export const VillageProductionClaimedEventRenderer = ({ event }: { event: VillageProductionClaimedEvent }) => {
  const buildingName = getBuildingName(event.buildingId, false);

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <span className="font-bold">Land #{event.landId}</span> claimed production from {buildingName}.
      </p>
    </EventWrapper>
  );
};

// Casino/Roulette Event Renderers
export const CasinoBuiltEventRenderer = ({ event, userAddress }: { event: CasinoBuiltEvent, userAddress?: string | null }) => {
  const isYou = userAddress && event.builder.toLowerCase() === userAddress.toLowerCase();

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <span className="font-bold">Land #{event.landId}</span> built a Casino{isYou ? " (You)" : ""}.
      </p>
    </EventWrapper>
  );
};

export const RouletteSpinResultEventRenderer = ({ event, userAddress }: { event: RouletteSpinResultEvent, userAddress?: string | null }) => {
  // Only render if player won
  if (!event.won) return null;

  const isYou = userAddress && event.player.toLowerCase() === userAddress.toLowerCase();
  const payoutFormatted = (Number(event.payout) / 1e18).toFixed(2);

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <span className="font-bold">Land #{event.landId}</span>{isYou ? " (You)" : ""} played <span className="font-bold">roulette</span> and won <span className="font-semibold text-value">{payoutFormatted} SEED</span>.
      </p>
    </EventWrapper>
  );
};