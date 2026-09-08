"use client";

import { useQuestConfiguration } from '@/hooks/useQuestConfiguration';
import { useTokenMetadata } from '@/hooks/useTokenMetadata';
import { LEAF_CONTRACT_ADDRESS, PIXOTCHI_TOKEN_ADDRESS } from '@/lib/contracts';
import { formatDurationSeconds } from '@/lib/duration-display';
import { formatUpgradeDuration } from '@/lib/utils';
import { QUEST_FINALIZE_EXPIRY_BLOCKS } from '@/lib/quest-ui';
import { formatTokenDisplay } from '@/lib/token-display';
import { ResourceState } from '@/components/ui/resource-state';
import { Button } from '@/components/ui/button';

export function QuestDifficultySummary({ value }: { value: number }) {
  const configuration = useQuestConfiguration();
  const seed = useTokenMetadata(PIXOTCHI_TOKEN_ADDRESS);
  const leaf = useTokenMetadata(LEAF_CONTRACT_ADDRESS);
  const selected = configuration.data?.difficulties[value];
  const ranges = configuration.data?.ranges;
  if (!configuration.isReady || !selected || !ranges) return <ResourceState status={configuration.isError ? 'error' : 'loading'}
    title={configuration.isError ? 'Quest terms unavailable' : 'Checking quest duration and rewards…'}
    description="Check the current quest duration and rewards before starting or returning. Existing loot bags can still be checked and opened."
    onRetry={() => { void configuration.refetch(); }} />;
  const multiplier = selected.rewardMultiplier;
  const amountRange = (minimum: bigint, maximum: bigint, decimals: number) => {
    const lower = minimum * multiplier;
    const upper = maximum * multiplier;
    const exact = `${formatTokenDisplay(lower, decimals, decimals)}–${formatTokenDisplay(upper, decimals, decimals)}`;
    return <span className="tabular-nums" title={exact} aria-label={exact}>
      {formatTokenDisplay(lower, decimals)}–{formatTokenDisplay(upper, decimals)}
    </span>;
  };
  return <div className="space-y-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
    <p>Estimated duration {formatUpgradeDuration(selected.durationInBlocks)} · {multiplier.toString()}× reward amounts. Difficulty changes the duration and reward size; the reward type and amount are random.</p>
    <p>After the quest, return your farmer and then open the loot bag in two separate transactions. Open within {QUEST_FINALIZE_EXPIRY_BLOCKS.toString()} blocks ({formatUpgradeDuration(QUEST_FINALIZE_EXPIRY_BLOCKS)}) after returning or the reward expires.</p>
    <details className="rounded-[var(--radius-control)] border border-border/60 p-2">
      <summary className="min-h-10 cursor-pointer py-2 font-medium text-foreground">Possible rewards</summary>
      <p className="my-2">Opening a loot bag in time can award one of these five reward types. Ranges below include this difficulty’s multiplier.</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
        <dt>SEED</dt><dd className="text-right">{seed.isReady && seed.decimals !== undefined ? amountRange(ranges.minSeedReward, ranges.maxSeedReward, seed.decimals) : 'Token details unavailable'}</dd>
        <dt>LEAF</dt><dd className="text-right">{leaf.isReady && leaf.decimals !== undefined ? amountRange(ranges.minLeafReward, ranges.maxLeafReward, leaf.decimals) : 'Token details unavailable'}</dd>
        <dt>Plant lifetime</dt><dd className="text-right">{formatDurationSeconds(ranges.minPlantLifetimeReward * multiplier)}–{formatDurationSeconds(ranges.maxPlantLifetimeReward * multiplier)}</dd>
        <dt>Plant points</dt><dd className="text-right">{amountRange(ranges.minPlantPointsReward, ranges.maxPlantPointsReward, 12)}</dd>
        <dt>Land XP</dt><dd className="text-right">{amountRange(ranges.minXpReward, ranges.maxXpReward, 18)}</dd>
      </dl>
      {(!seed.isReady || !leaf.isReady) && <Button variant="outline" className="mt-2" onClick={() => { void seed.refetch(); void leaf.refetch(); }}>Retry token details</Button>}
      <p className="mt-2">These are the current configured ranges, not a guaranteed payout. Settings may change before your quest is opened.</p>
    </details>
  </div>;
}
