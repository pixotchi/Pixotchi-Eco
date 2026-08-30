"use client";

import { useTokenMetadata } from '@/hooks/useTokenMetadata';
import type { ActivityPerspective } from '@/lib/activity-filters';
import { ITEM_ICONS } from '@/lib/constants';
import {
ActivityEvent,AttackEvent,BaccaratRoundResultEvent,BarracksBuiltEvent,
BarracksRaidEvent,BlackjackResultEvent,BundledItemConsumedEvent,CasinoBuiltEvent,KilledEvent,LandMintedEvent,
LandNameChangedEvent,LandTransferEvent,MintEvent,PlayedEvent,QuestFinalizedEvent,QuestStartedEvent,RouletteSpinResultEvent,ShopItemPurchasedEvent,TownSpeedUpWithSeedEvent,TownUpgradedWithLeafEvent,VillageProductionClaimedEvent,VillageSpeedUpWithSeedEvent,VillageUpgradedWithLeafEvent
} from '@/lib/types';
import { formatDuration,formatQuestReward,formatScore,formatTokenAmount,getBuildingName,getQuestDifficulty } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { HelpCircle } from 'lucide-react';
import Image from 'next/image';
import React from 'react';

const SHOP_ITEM_OVERRIDES: Record<string, { name: string; icon: string }> = {
  '1': { name: 'Fence', icon: '/icons/Fence.png' },
};

/*
 * One module-level 30s clock shared by every TimeAgo instance. Timestamps were
 * memoized purely on the (fixed) event timestamp, so "less than a minute ago"
 * stayed frozen for the whole session.
 */
const slowTickSubscribers = new Set<() => void>();
let slowTickInterval: ReturnType<typeof setInterval> | null = null;
let slowTickValue = 0;
function subscribeSlowTick(callback: () => void) {
  slowTickSubscribers.add(callback);
  if (slowTickInterval === null) {
    slowTickInterval = setInterval(() => {
      slowTickValue += 1;
      slowTickSubscribers.forEach((subscriber) => subscriber());
    }, 30_000);
  }
  return () => {
    slowTickSubscribers.delete(callback);
    if (slowTickSubscribers.size === 0 && slowTickInterval !== null) {
      clearInterval(slowTickInterval);
      slowTickInterval = null;
    }
  };
}
function useSlowTick() {
  return React.useSyncExternalStore(subscribeSlowTick, () => slowTickValue, () => 0);
}

const TimeAgo = React.memo(({ timestamp }: { timestamp: string }) => {
  const tick = useSlowTick();
  const timeAgo = React.useMemo(() => {
    const date = new Date(parseInt(timestamp) * 1000);
    return formatDistanceToNow(date, { addSuffix: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timestamp, tick]);

  return <span className="text-xs text-muted-foreground">{timeAgo}</span>;
});
TimeAgo.displayName = 'TimeAgo';

const EventIcon = React.memo(({
  type,
  event,
  shopItemMap,
  gardenItemMap
}: {
  type: ActivityEvent['__typename'],
  event?: UntypedValue,
  shopItemMap?: { [key: string]: string },
  gardenItemMap?: { [key: string]: string }
}) => {
  const iconClass = "w-6 h-6 object-contain";

  const { iconSrc, altText } = React.useMemo(() => {
    switch (type) {
      case 'Attack':
        if (event && event.attacker === event.winner) {
          return { iconSrc: "/icons/Attackwon.png", altText: "Attack Won" };
        } else {
          return { iconSrc: "/icons/Attacklost.png", altText: "Attack Lost" };
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
        return { iconSrc: "/icons/ware-house.png", altText: "Land Transfer" };
      case 'LandMintedEvent':
        return { iconSrc: "/icons/farmer-house.png", altText: "Land Minted" };
      case 'LandNameChangedEvent':
        return { iconSrc: "/icons/farmer-house.png", altText: "Land Renamed" };
      case 'VillageUpgradedWithLeafEvent':
      case 'VillageSpeedUpWithSeedEvent':
        if (event && event.buildingId !== undefined) {
          const buildingName = getBuildingName(event.buildingId, false);
          const buildingIcons: { [key: string]: string } = {
            "Solar Panels": "/icons/solar-panels.png",
            "Soil Factory": "/icons/soil-factory.png",
            "Bee Farm": "/icons/bee-house.png"
          };
          return { iconSrc: buildingIcons[buildingName] || "/icons/solar-panels.png", altText: buildingName };
        }
        return { iconSrc: "/icons/solar-panels.png", altText: "Village Building" };
      case 'TownUpgradedWithLeafEvent':
      case 'TownSpeedUpWithSeedEvent':
        if (event && event.buildingId !== undefined) {
          const buildingName = getBuildingName(event.buildingId, true);
          const buildingIcons: { [key: string]: string } = {
            "Stake House": "/icons/stake-house.png",
            "Ware House": "/icons/ware-house.png",
            "Marketplace": "/icons/marketplace.png",
            "Farmer House": "/icons/farmer-house.png"
          };
          return { iconSrc: buildingIcons[buildingName] || "/icons/marketplace.png", altText: buildingName };
        }
        return { iconSrc: "/icons/marketplace.png", altText: "Town Building" };
      case 'QuestStartedEvent':
      case 'QuestFinalizedEvent':
        return { iconSrc: "/icons/stake-house.png", altText: "Quest" };
      case 'VillageProductionClaimedEvent':
        if (event && event.buildingId !== undefined) {
          const buildingName = getBuildingName(event.buildingId, false);
          const buildingIcons: { [key: string]: string } = {
            "Solar Panels": "/icons/solar-panels.png",
            "Soil Factory": "/icons/soil-factory.png",
            "Bee Farm": "/icons/bee-house.png"
          };
          return { iconSrc: buildingIcons[buildingName] || "/icons/bee-house.png", altText: buildingName };
        }
        return { iconSrc: "/icons/bee-house.png", altText: "Production" };
      case 'BarracksRaidEvent':
        return {
          iconSrc: event?.attackerWon ? "/icons/Attackwon.png" : "/icons/Attacklost.png",
          altText: event?.attackerWon ? "Raid Won" : "Raid Lost"
        };
      case 'BarracksBuiltEvent':
        return { iconSrc: "/icons/barracks.webp", altText: "Barracks Built" };
      case 'CasinoBuiltEvent':
        return { iconSrc: "/icons/casino.png", altText: "Casino Built" };
      case 'RouletteSpinResultEvent':
        return { iconSrc: "/icons/casino.png", altText: "Roulette Win" };
      case 'BlackjackResultEvent':
        return { iconSrc: "/icons/casino.png", altText: "Blackjack" };
      case 'BaccaratRoundResultEvent':
        return { iconSrc: "/icons/casino.png", altText: "Baccarat" };
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
EventIcon.displayName = 'EventIcon';

const YouBadge = () => (
  <span className="ml-1 text-xs font-semibold text-[hsl(var(--info))]">(You)</span>
);

const activityAssetNameClass = "font-pixel text-[0.86em] leading-normal";

const PlantName = ({ name, id, isYou }: { name?: string, id: string, isYou: boolean }) => (
  <span className={`${activityAssetNameClass} ${isYou ? 'text-[hsl(var(--info))]' : ''}`}>
    {name || `Plant #${id}`}
    {isYou && <YouBadge />}
  </span>
);

const LandName = ({ landId, isYou }: { landId: string | number | bigint, isYou: boolean }) => (
  <span className={`${activityAssetNameClass} ${isYou ? 'text-[hsl(var(--info))]' : ''}`}>
    Land #{landId}
    {isYou && <YouBadge />}
  </span>
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
  <div className="flex items-start gap-3 px-2 py-2">
    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[hsl(var(--border-strong)/0.28)] bg-card/75 bg-[image:var(--gradient-surface)] shadow-[var(--shadow-hairline)]">
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
  perspective,
  shopItemMap,
  gardenItemMap
}: {
  event: AttackEvent,
  perspective?: ActivityPerspective,
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

    // Plant IDS against the viewer's owned-plant set. The old check compared a
    // plant NAME to a wallet ADDRESS, so "(You)" never rendered for anyone.
    const attackerYou = Boolean(perspective?.plantIds.has(String(event.attacker)));
    const opponentYou = Boolean(perspective?.plantIds.has(String(opp.id)));
    const score = formatScore(parseInt(event.scoresWon));

    return {
      attackerIsWinner: winner,
      opponent: opp,
      isAttackerYou: attackerYou,
      isOpponentYou: opponentYou,
      formattedScore: score
    };
  }, [event, perspective]);

  return (
    <EventWrapper event={event} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap}>
      <p className="text-sm">
        <PlantName name={event.attackerName} id={event.attacker} isYou={!!isAttackerYou} />
        {' attacked '}
        <PlantName name={opponent.name} id={opponent.id} isYou={!!isOpponentYou} />
        {attackerIsWinner ? ' and won ' : ' and lost '}
        {/* Wins and losses used the same --value cyan, so the feed could not be
            scanned at a glance; only a small icon distinguished them. */}
        <span
          className={
            attackerIsWinner
              ? 'font-semibold text-[hsl(var(--success-strong))]'
              : 'font-semibold text-destructive'
          }
        >
          {formattedScore}
        </span>
        {' PTS!'}
      </p>
    </EventWrapper>
  );
});

export const KilledEventRenderer = ({ event, perspective, shopItemMap, gardenItemMap }: { event: KilledEvent, perspective?: ActivityPerspective, shopItemMap?: { [key: string]: string }, gardenItemMap?: { [key: string]: string } }) => {
  const isWinnerYou = Boolean(perspective?.plantIds.has(String(event.nftId)));
  const isLoserYou = Boolean(perspective?.plantIds.has(String(event.deadId)));

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
      <PlantName id={event.nftId} isYou={false} />, was born!
    </p>
  </EventWrapper>
);

export const PlayedEventRenderer = ({ event, perspective, shopItemMap, gardenItemMap }: { event: PlayedEvent, perspective?: ActivityPerspective, shopItemMap?: { [key: string]: string }, gardenItemMap?: { [key: string]: string } }) => {
  const isYou = Boolean(perspective?.plantIds.has(String(event.nftId)));
  const displayGameName = GAME_NAME_ALIASES[event.gameName] ?? event.gameName;
  const pointsDelta = Number(event.points ?? "0");
  const timeBonusSeconds = event.timeAdded ?? event.timeExtension ? Number(event.timeAdded ?? event.timeExtension ?? "0") : 0;
  const leafReward = event.leafAmount ? BigInt(String(event.leafAmount)) : BigInt("0");

  const rewardChips: React.ReactNode[] = [];

  if (pointsDelta !== 0) {
    rewardChips.push(
      <span key="points" className="font-semibold text-value">
        {`${pointsDelta > 0 ? '+' : '-'}${formatScore(Math.abs(pointsDelta))} PTS`}
      </span>
    );
  }

  if (timeBonusSeconds !== 0) {
    rewardChips.push(
      <span key="tod" className="font-semibold text-value">
        {`${timeBonusSeconds > 0 ? '+' : '-'}${formatDuration(Math.abs(timeBonusSeconds))} TOD`}
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

export const ItemConsumedEventRenderer = ({ event, perspective, itemMap, shopItemMap, gardenItemMap }: { event: BundledItemConsumedEvent, perspective?: ActivityPerspective, itemMap: { [key: string]: string }, shopItemMap?: { [key: string]: string }, gardenItemMap?: { [key: string]: string } }) => {
  const isYou = Boolean(perspective?.plantIds.has(String(event.nftId)));
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

export const ShopItemPurchasedEventRenderer = ({ event, perspective, itemMap, shopItemMap, gardenItemMap }: { event: ShopItemPurchasedEvent, perspective?: ActivityPerspective, itemMap: { [key: string]: string }, shopItemMap?: { [key: string]: string }, gardenItemMap?: { [key: string]: string } }) => {
  const isYou = Boolean(perspective?.plantIds.has(String(event.nftId)));
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

export const LandMintedEventRenderer = ({ event }: { event: LandMintedEvent, userAddress?: string | null }) => {
  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        A new land, <LandName landId={event.tokenId} isYou={false} />, was claimed!
      </p>
    </EventWrapper>
  );
};

export const LandNameChangedEventRenderer = ({ event }: { event: LandNameChangedEvent }) => (
    <EventWrapper event={event}>
      <p className="text-sm">
      <LandName landId={event.tokenId} isYou={false} /> was renamed to &quot;<span className={activityAssetNameClass}>{event.name}</span>&quot;.
      </p>
    </EventWrapper>
  );

export const VillageUpgradeEventRenderer = ({ event }: { event: VillageUpgradedWithLeafEvent, userAddress?: string | null }) => {
  const buildingName = getBuildingName(event.buildingId, false);

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <LandName landId={event.landId} isYou={false} /> started upgrading {buildingName}.
      </p>
    </EventWrapper>
  );
};

export const VillageSpeedUpEventRenderer = ({ event }: { event: VillageSpeedUpWithSeedEvent, userAddress?: string | null }) => {
  const buildingName = getBuildingName(event.buildingId, false);

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <LandName landId={event.landId} isYou={false} /> sped up {buildingName} construction.
      </p>
    </EventWrapper>
  );
};

export const TownUpgradeEventRenderer = ({ event }: { event: TownUpgradedWithLeafEvent, userAddress?: string | null }) => {
  const buildingName = getBuildingName(event.buildingId, true);

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <LandName landId={event.landId} isYou={false} /> started upgrading {buildingName}.
      </p>
    </EventWrapper>
  );
};

export const TownSpeedUpEventRenderer = ({ event }: { event: TownSpeedUpWithSeedEvent, userAddress?: string | null }) => {
  const buildingName = getBuildingName(event.buildingId, true);

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <LandName landId={event.landId} isYou={false} /> sped up {buildingName} construction.
      </p>
    </EventWrapper>
  );
};

export const QuestStartedEventRenderer = ({ event }: { event: QuestStartedEvent }) => {
  const difficulty = getQuestDifficulty(event.difficulty);

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <LandName landId={event.landId} isYou={false} /> started a {difficulty} quest.
      </p>
    </EventWrapper>
  );
};

export const QuestFinalizedEventRenderer = ({ event }: { event: QuestFinalizedEvent, userAddress?: string | null }) => {
  const reward = formatQuestReward(event.rewardType, event.amount);

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <LandName landId={event.landId} isYou={false} /> completed a quest and earned <span className="font-semibold text-value">{reward}</span>.
      </p>
    </EventWrapper>
  );
};

export const VillageProductionClaimedEventRenderer = ({ event }: { event: VillageProductionClaimedEvent }) => {
  const buildingName = getBuildingName(event.buildingId, false);

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <LandName landId={event.landId} isYou={false} /> claimed production from {buildingName}.
      </p>
    </EventWrapper>
  );
};

export const BarracksBuiltEventRenderer = ({ event }: { event: BarracksBuiltEvent }) => (
  <EventWrapper event={event}>
    <p className="text-sm">
      <LandName landId={event.landId} isYou={false} /> built Barracks.
    </p>
  </EventWrapper>
);

export const BarracksRaidEventRenderer = ({ event }: { event: BarracksRaidEvent }) => (
  <EventWrapper event={event}>
    <p className="text-sm">
      <LandName landId={event.attackerLandId} isYou={false} />
      {" attacked "}
      <LandName landId={event.defenderLandId} isYou={false} />
      {event.attackerWon ? " and won." : " and lost."}
    </p>
  </EventWrapper>
);

// Casino/Roulette Event Renderers
export const CasinoBuiltEventRenderer = ({ event, userAddress }: { event: CasinoBuiltEvent, userAddress?: string | null }) => {
  const isYou = userAddress && event.builder.toLowerCase() === userAddress.toLowerCase();

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <LandName landId={event.landId} isYou={!!isYou} /> built a Casino.
      </p>
    </EventWrapper>
  );
};

export const RouletteSpinResultEventRenderer = ({ event, userAddress }: { event: RouletteSpinResultEvent, userAddress?: string | null }) => {
  const isYou = userAddress && event.player.toLowerCase() === userAddress.toLowerCase();
  const { symbol: tokenSymbol, decimals: tokenDecimals } = useTokenMetadata(event.bettingToken as `0x${string}`);
  const payoutFormatted = formatTokenAmount(BigInt(event.payout), tokenDecimals);
  const displaySymbol = tokenSymbol || 'TOKEN';

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <LandName landId={event.landId} isYou={!!isYou} /> played <span className="font-bold">Roulette</span>
        {event.won ? (
          <> and won <span className="font-semibold text-value">{payoutFormatted} {displaySymbol}</span>.</>
        ) : (
          <> and lost.</>
        )}
      </p>
    </EventWrapper>
  );
};

export const BlackjackResultEventRenderer = ({ event, userAddress }: { event: BlackjackResultEvent, userAddress?: string | null }) => {
  const isYou = userAddress && event.player.toLowerCase() === userAddress.toLowerCase();
  const { symbol: tokenSymbol, decimals: tokenDecimals } = useTokenMetadata(event.bettingToken as `0x${string}`);
  const payoutFormatted = formatTokenAmount(BigInt(event.payout), tokenDecimals);
  const won = Number(event.payout) > 0;
  const displaySymbol = tokenSymbol || 'TOKEN';

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <LandName landId={event.landId} isYou={!!isYou} /> played <span className="font-bold">Blackjack</span>
        {won ? (
          <> and won <span className="font-semibold text-value">{payoutFormatted} {displaySymbol}</span>.</>
        ) : (
          <> and lost.</>
        )}
      </p>
    </EventWrapper>
  );
};

export const BaccaratRoundResultEventRenderer = ({ event, userAddress }: { event: BaccaratRoundResultEvent, userAddress?: string | null }) => {
  const isYou = userAddress && event.player.toLowerCase() === userAddress.toLowerCase();
  const { symbol: tokenSymbol, decimals: tokenDecimals } = useTokenMetadata(event.bettingToken as `0x${string}`);
  const payoutFormatted = formatTokenAmount(BigInt(event.payout), tokenDecimals);
  const displaySymbol = tokenSymbol || 'TOKEN';
  const pushed = !event.won && BigInt(event.payout) > BigInt(0);

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <LandName landId={event.landId} isYou={!!isYou} /> played <span className="font-bold">Baccarat</span>
        {event.won ? (
          <> and won <span className="font-semibold text-value">{payoutFormatted} {displaySymbol}</span>.</>
        ) : pushed ? (
          <> and pushed.</>
        ) : (
          <> and lost.</>
        )}
      </p>
    </EventWrapper>
  );
};
