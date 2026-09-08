"use client";

import { useTokenMetadata } from '@/hooks/useTokenMetadata';
import type { ActivityPerspective } from '@/lib/activity-filters';
import type { WarehouseAssignmentEvent } from '@/lib/types';
import { getActivityAssetId, getActivityAttackOutcome, getActivityItem, getActivitySource, getPlayedRewardSummary, ACTIVITY_GAME_NAMES } from '@/lib/activity-metadata';
import { ActivityRecord } from './activity-record';
import {
ActivityEvent,AttackEvent,BaccaratRoundResultEvent,BarracksBuiltEvent,
BarracksRaidEvent,BlackjackResultEvent,BundledItemConsumedEvent,CasinoBuiltEvent,KilledEvent,LandMintedEvent,
LandNameChangedEvent,LandTransferEvent,MintEvent,PlayedEvent,QuestFinalizedEvent,QuestStartedEvent,RouletteSpinResultEvent,ShopItemPurchasedEvent,TownSpeedUpWithSeedEvent,TownUpgradedWithLeafEvent,VillageProductionClaimedEvent,VillageSpeedUpWithSeedEvent,VillageUpgradedWithLeafEvent
} from '@/lib/types';
import { formatDuration,formatQuestReward,formatScore,formatTokenAmount,getBuildingName,getQuestDifficulty } from '@/lib/utils';
import React from 'react';
import { activityInteger, blackjackActivityOutcome } from '@/lib/activity-presentation';

export const ActivityIdentityContext = React.createContext<ActivityPerspective | undefined>(undefined);

const YouBadge = () => (
  <span className="ml-1 text-xs font-semibold text-info-strong">(You)</span>
);

const activityAssetNameClass = "font-pixel text-[0.86em] leading-normal";

const PlantName = ({ name, id, isYou }: { name?: string, id: string, isYou: boolean }) => {
  const plantId = getActivityAssetId(id);
  const owned = plantId !== null && isYou;
  return <span className={`${activityAssetNameClass} ${owned ? 'text-info-strong' : ''}`}>
    {name || (plantId === null ? 'A plant' : `Plant #${plantId}`)}
    {owned && <YouBadge />}
  </span>;
};

const LandName = ({ landId, isYou }: { landId: string | number | bigint, isYou: boolean }) => {
  const perspective = React.useContext(ActivityIdentityContext);
  const id = getActivityAssetId(landId);
  const owned = id !== null && (isYou || Boolean(perspective?.landIds.has(id)));
  return <span className={`${activityAssetNameClass} ${owned ? 'text-info-strong' : ''}`}>
    {id === null ? 'A land' : `Land #${id}`}
    {owned && <YouBadge />}
  </span>;
};

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
}) => {
  const perspective = React.useContext(ActivityIdentityContext);
  const source = getActivitySource(event);
  const isMine = source.id !== null && Boolean(source.kind === 'land' ? perspective?.landIds.has(source.id) : perspective?.plantIds.has(source.id));
  return <ActivityRecord event={event} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap} isMine={isMine}>{children}</ActivityRecord>;
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
    const winner = getActivityAttackOutcome(event);
    const opp = winner
      ? { id: event.loser, name: event.loserName }
      : { id: event.winner, name: event.winnerName };

    // Plant IDS against the viewer's owned-plant set. The old check compared a
    // plant NAME to a wallet ADDRESS, so "(You)" never rendered for anyone.
    const attackerYou = Boolean(perspective?.plantIds.has(String(event.attacker)));
    const opponentYou = Boolean(perspective?.plantIds.has(String(opp.id)));
    const rawScore = activityInteger(event.scoresWon);
    const score = rawScore !== null && Number.isFinite(Number(rawScore)) ? formatScore(Number(rawScore)) : 'Amount unavailable';

    return {
      attackerIsWinner: winner,
      opponent: opp,
      isAttackerYou: attackerYou,
      isOpponentYou: opponentYou,
      formattedScore: score
    };
  }, [event, perspective]);

  if (attackerIsWinner === null) {
    return <EventWrapper event={event} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap}>
      <p className="text-sm"><PlantName name={event.attackerName} id={event.attacker} isYou={!!isAttackerYou} /> took part in an attack. The result is unavailable.</p>
    </EventWrapper>;
  }

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
  const displayGameName = ACTIVITY_GAME_NAMES[event.gameName] ?? event.gameName;
  const rewardSummary = getPlayedRewardSummary(event);

  return (
    <EventWrapper event={event} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap}>
      <p className="text-sm">
        <PlantName name={event.nftName} id={event.nftId} isYou={!!isYou} /> played <span className="font-semibold">{displayGameName}</span>: {rewardSummary}.
      </p>
    </EventWrapper>
  );
};

export const ItemConsumedEventRenderer = ({ event, perspective, itemMap, shopItemMap, gardenItemMap }: { event: BundledItemConsumedEvent, perspective?: ActivityPerspective, itemMap: { [key: string]: string }, shopItemMap?: { [key: string]: string }, gardenItemMap?: { [key: string]: string } }) => {
  const isYou = Boolean(perspective?.plantIds.has(String(event.nftId)));
  const itemName = getActivityItem(event.itemId, 'garden', itemMap).name;
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
  const itemName = getActivityItem(event.itemId, 'shop', itemMap).name;
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

export const WarehouseAssignmentEventRenderer = ({ event }: { event: WarehouseAssignmentEvent }) => {
  const plantId = getActivityAssetId(event.plantId);
  return <EventWrapper event={event}>
    <p className="text-sm">
      <LandName landId={event.landId} isYou={false} /> applied{' '}
      <span className="font-semibold text-value">{event.resource === 'points'
        ? `${formatScore(Number(event.amount))} PTS`
        : `${formatDuration(Number(event.amount))} lifetime`}</span>{' '}
      from its warehouse to <span className="font-bold">{plantId === null ? 'a plant' : `Plant #${plantId}`}</span>.
    </p>
  </EventWrapper>;
};

export const RouletteSpinResultEventRenderer = ({ event, userAddress }: { event: RouletteSpinResultEvent, userAddress?: string | null }) => {
  const isYou = userAddress && event.player.toLowerCase() === userAddress.toLowerCase();
  const { symbol: tokenSymbol, decimals: tokenDecimals } = useTokenMetadata(event.bettingToken as `0x${string}`);
  const payout = activityInteger(event.payout);
  const payoutFormatted = tokenDecimals === undefined || payout === null ? 'Amount unavailable' : formatTokenAmount(payout, tokenDecimals);
  const displaySymbol = tokenSymbol ?? '';

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
  const payout = activityInteger(event.payout);
  const payoutFormatted = tokenDecimals === undefined || payout === null ? 'Amount unavailable' : formatTokenAmount(payout, tokenDecimals);
  const outcome = blackjackActivityOutcome(Number(event.result));
  const displaySymbol = tokenSymbol ?? '';

  return (
    <EventWrapper event={event}>
      <p className="text-sm">
        <LandName landId={event.landId} isYou={!!isYou} /> played <span className="font-bold">Blackjack</span>
        {' and '}{outcome.label}.
        {(payout === null || payout > BigInt(0)) && <> {outcome.won ? 'Payout' : 'Returned'}: <span className="font-semibold text-value">{payoutFormatted} {displaySymbol}</span>.</>}
      </p>
    </EventWrapper>
  );
};

export const BaccaratRoundResultEventRenderer = ({ event, userAddress }: { event: BaccaratRoundResultEvent, userAddress?: string | null }) => {
  const isYou = userAddress && event.player.toLowerCase() === userAddress.toLowerCase();
  const { symbol: tokenSymbol, decimals: tokenDecimals } = useTokenMetadata(event.bettingToken as `0x${string}`);
  const payout = activityInteger(event.payout);
  const payoutFormatted = tokenDecimals === undefined || payout === null ? 'Amount unavailable' : formatTokenAmount(payout, tokenDecimals);
  const displaySymbol = tokenSymbol ?? '';
  const pushed = !event.won && payout !== null && payout > BigInt(0);

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
