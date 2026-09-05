"use client";

import type { BuildingData, BuildingType, Land } from '@/lib/types';
import Image from 'next/image';
import { ChevronRight, Hammer } from 'lucide-react';
import { getLandActionSummary } from '@/lib/land-summary';
import { formatTokenDisplay } from '@/lib/token-display';
import { formatDurationSeconds } from '@/lib/duration-display';
import { getBuildingIcon, getBuildingName } from '@/lib/utils';
import { Button } from './ui/button';
import { ResourceState } from './ui/resource-state';
import { getUnlockedQuestSlots, summarizeQuestSlots, type QuestSlot } from '@/lib/quest-slots';

type QuestSummaryProps = { slots: readonly QuestSlot[]; loading: boolean; error: string | null; ready: boolean; refresh: () => Promise<QuestSlot[] | null> };

export function LandQuestSummary({ quests, block, onOpen }: { quests: QuestSummaryProps; block: bigint; onOpen?: () => void }) {
  const counts = quests.ready ? summarizeQuestSlots(quests.slots, block) : null;
  const labels = counts ? [
    counts.expired && `${counts.expired} expired · reset required`,
    counts.committed && `${counts.committed} loot ${counts.committed === 1 ? 'bag' : 'bags'} ready`,
    counts.ready_to_commit && `${counts.ready_to_commit} ready to return`,
    counts.in_progress && `${counts.in_progress} in progress`,
    counts.cooldown && `${counts.cooldown} resting`,
    counts.available && `${counts.available} available`,
  ].filter(Boolean) : [];
  const heading = <><Image src="/icons/farmer-house.png" alt="" width={32} height={32} className="h-8 w-8 shrink-0 object-contain" /><span className="flex-1 text-left font-medium">Farmer quests</span></>;
  return <div aria-label="Quest overview" className="space-y-1 text-sm">
    {onOpen ? <Button variant="ghost" aria-label="View farmer quests" onClick={onOpen} className="min-h-11 w-full justify-start gap-3 px-0 hover:bg-transparent">{heading}<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /></Button>
      : <h4 className="flex items-center gap-3">{heading}</h4>}
    <div className="pl-11">
    {quests.error ? <><p role="alert" className="text-destructive">{quests.error}</p><Button size="touchCompact" variant="outline" onClick={() => { void quests.refresh(); }}>Retry quests</Button></>
      : quests.loading || !counts ? <p role="status" className="text-muted-foreground">Checking quest timing…</p>
      : <p className={counts.expired || counts.committed ? 'text-[hsl(var(--warning-strong))]' : 'text-muted-foreground'}>{labels.length ? labels.join(' · ') : 'No unlocked quest slots.'}</p>}
    </div>
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
  const actionsReady = !error && !loading;
  return <section aria-label="Land actions" className="space-y-4 rounded-[var(--radius-panel)] border border-border bg-card p-4">
    <h3 className="flex items-center gap-2 text-sm font-semibold"><Image src="/icons/landIcon.png" alt="" width={24} height={24} className="h-6 w-6 object-contain" />Land overview</h3>
    <div className="rounded-[var(--radius-control)] bg-muted/35 p-3">
      <div className="mb-3 flex min-h-8 items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 font-medium"><Image src="/icons/ware-house.png" alt="" width={24} height={24} className="h-6 w-6 object-contain" />Warehouse</span>
        {actionsReady && warehouse && <Button variant="ghost" size="touchCompact" aria-label="Use stored resources" className="-my-1 -mr-2 gap-1 px-2 text-xs text-primary" onClick={() => onSelect('town', warehouse)}>Use resources<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Button>}
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div className="min-w-0"><dt className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Image src="/icons/pts.svg" alt="" width={18} height={18} />Points</dt><dd className="break-words text-sm font-semibold tabular-nums">{formatTokenDisplay(land.accumulatedPlantPoints, 12)} PTS</dd></div>
        <div className="min-w-0"><dt className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Image src="/icons/tod.svg" alt="" width={18} height={18} />Lifetime</dt><dd className="break-words text-sm font-semibold tabular-nums">{formatDurationSeconds(land.accumulatedPlantLifetime)}</dd></div>
      </dl>
    </div>
    {error ? <ResourceState status="error" title="Buildings unavailable" description={error} onRetry={onRetry} /> : loading ? <p role="status" className="text-sm text-muted-foreground">Checking land actions…</p> : <>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs font-medium"><span>Ready to collect</span><span className="rounded-full bg-emerald-500/15 px-2 py-0.5 tabular-nums text-emerald-800 dark:text-emerald-300">{summary.ready.length}</span></div>
        {summary.ready.length === 0 ? <p className="py-2 text-xs text-muted-foreground">Your production buildings are still growing.</p> : summary.ready.map(building => <Button key={building.id} variant="ghost" aria-label={`Collect: ${getBuildingName(building.id)}`} onClick={() => onSelect('village', building)} className="h-auto min-h-14 w-full justify-start gap-3 whitespace-normal px-0 text-left hover:bg-muted/30">
          <Image src={getBuildingIcon(getBuildingName(building.id))} alt="" width={32} height={32} className="h-8 w-8 shrink-0 object-contain" />
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{getBuildingName(building.id)}</span><span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-normal text-muted-foreground">
            {building.accumulatedPoints > BigInt(0) && <span className="inline-flex items-center gap-1"><Image src="/icons/pts.svg" alt="" width={14} height={14} />{formatTokenDisplay(building.accumulatedPoints, 12)} PTS</span>}
            {building.accumulatedLifetime > BigInt(0) && <span className="inline-flex items-center gap-1"><Image src="/icons/tod.svg" alt="" width={14} height={14} />{formatDurationSeconds(building.accumulatedLifetime)}</span>}
          </span></span><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>)}
      </div>
      {farmers && <div className="border-t border-border/60 pt-3">{quests ? <LandQuestSummary quests={{ ...quests, slots: getUnlockedQuestSlots(quests.slots, farmers.level) }} block={block} onOpen={() => onSelect('town', farmers)} />
        : <Button variant="ghost" aria-label="View farmer quests" onClick={() => onSelect('town', farmers)} className="min-h-11 w-full justify-start gap-3 px-0"><Image src="/icons/farmer-house.png" alt="" width={32} height={32} /><span className="flex-1 text-left">Farmer quests</span><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>}</div>}
      {summary.upgrades.map(({ type, building, ready }) => <Button key={`${type}-${building.id}`} variant="ghost" className="h-auto min-h-11 w-full justify-start gap-3 whitespace-normal px-0 text-left" onClick={() => onSelect(type, building)}><Hammer className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" /><span className="min-w-0 flex-1 text-xs"><span className="block font-medium">{getBuildingName(building.id, type === 'town')}</span><span className="text-muted-foreground">{ready ? 'Upgrade ready to finish' : 'Upgrade in progress'}</span></span><ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" /></Button>)}
    </>}
  </section>;
}
