"use client";

import type { BuildingData, BuildingType, Land } from '@/lib/types';
import { getLandActionSummary } from '@/lib/land-summary';
import { formatTokenDisplay } from '@/lib/token-display';
import { formatDurationSeconds } from '@/lib/duration-display';
import { getBuildingName } from '@/lib/utils';
import { Button } from './ui/button';
import { ResourceState } from './ui/resource-state';
import { getUnlockedQuestSlots, summarizeQuestSlots, type QuestSlot } from '@/lib/quest-slots';

type QuestSummaryProps = { slots: readonly QuestSlot[]; loading: boolean; error: string | null; ready: boolean; refresh: () => Promise<QuestSlot[] | null> };

export function LandQuestSummary({ quests, block }: { quests: QuestSummaryProps; block: bigint }) {
  const counts = quests.ready ? summarizeQuestSlots(quests.slots, block) : null;
  const labels = counts ? [
    counts.expired && `${counts.expired} expired · reset required`,
    counts.committed && `${counts.committed} loot ${counts.committed === 1 ? 'bag' : 'bags'} ready`,
    counts.ready_to_commit && `${counts.ready_to_commit} ready to return`,
    counts.in_progress && `${counts.in_progress} in progress`,
    counts.cooldown && `${counts.cooldown} resting`,
    counts.available && `${counts.available} available`,
  ].filter(Boolean) : [];
  return <div aria-label="Quest overview" className="space-y-1 border-t border-border pt-3 text-sm">
    <h4 className="font-medium">Farmer quests</h4>
    {quests.error ? <><p role="alert" className="text-destructive">{quests.error}</p><Button size="touchCompact" variant="outline" onClick={() => { void quests.refresh(); }}>Retry quests</Button></>
      : quests.loading || !counts ? <p role="status" className="text-muted-foreground">Checking quest timing…</p>
      : <p className={counts.expired || counts.committed ? 'text-[hsl(var(--warning-strong))]' : 'text-muted-foreground'}>{labels.length ? labels.join(' · ') : 'No unlocked quest slots.'}</p>}
  </div>;
}

export function LandActionSummary({ land, village, town, block, loading, error, onRetry, onSelect, quests }: {
  land: Pick<Land, 'accumulatedPlantPoints' | 'accumulatedPlantLifetime'>; village: readonly BuildingData[]; town: readonly BuildingData[]; block: bigint;
  loading: boolean; error?: string | null; onRetry: () => void;
  onSelect: (type: BuildingType, building: BuildingData) => void;
  quests?: QuestSummaryProps;
}) {
  const summary = getLandActionSummary(village, town, block);
  const warehouse = town.find(b => b.id === 3);
  const farmers = town.find(b => b.id === 7 && b.level > 0);
  return <section aria-label="Land actions" className="space-y-3 rounded-[var(--radius-panel)] border border-border bg-card p-4">
    <h3 className="text-sm font-semibold">Your land at a glance</h3>
    <div className="flex flex-wrap justify-between gap-2 text-sm">
      <span>In Warehouse</span>
      <span className="tabular-nums">{formatTokenDisplay(land.accumulatedPlantPoints, 12)} PTS · {formatDurationSeconds(land.accumulatedPlantLifetime)} lifetime</span>
    </div>
    {error ? <ResourceState status="error" title="Buildings unavailable" description={error} onRetry={onRetry} /> : loading ? <p role="status" className="text-sm text-muted-foreground">Checking land actions…</p> : <>
      <p className="text-sm text-muted-foreground">{summary.ready.length ? `${summary.ready.length} production ${summary.ready.length === 1 ? 'building has' : 'buildings have'} resources to collect.` : 'No production ready to collect.'}</p>
      <div className="flex flex-wrap gap-2">
        {summary.ready.map(building => <Button key={building.id} variant="outline" size="touchCompact" onClick={() => onSelect('village', building)}>Collect: {getBuildingName(building.id)}</Button>)}
        {warehouse && <Button variant="outline" size="touchCompact" onClick={() => onSelect('town', warehouse)}>Use stored resources</Button>}
        {farmers && <Button variant="outline" size="touchCompact" onClick={() => onSelect('town', farmers)}>View farmer quests</Button>}
      </div>
      {farmers && quests && <LandQuestSummary quests={{ ...quests, slots: getUnlockedQuestSlots(quests.slots, farmers.level) }} block={block} />}
      {summary.upgrades.map(({ type, building, ready }) => <Button key={`${type}-${building.id}`} variant="ghost" className="h-auto min-h-11 w-full justify-start whitespace-normal text-left" onClick={() => onSelect(type, building)}>{getBuildingName(building.id, type === 'town')}: {ready ? 'Upgrade ready to finish' : 'Upgrade in progress'}</Button>)}
    </>}
  </section>;
}
