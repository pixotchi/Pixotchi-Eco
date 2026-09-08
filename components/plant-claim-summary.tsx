import { formatEth, formatScore } from '@/lib/utils';

export function PlantClaimSummary({ points, level, rewards, descriptionId }: {
  points: number; level: number; rewards: number; descriptionId: string;
}) {
  return <div id={descriptionId} className="space-y-3 text-sm">
    <p className="text-muted-foreground">Claiming removes all of this plant&apos;s PTS and resets it to level 1. You keep the plant. This cannot be undone.</p>
    <dl className="space-y-2 rounded-[var(--radius-panel)] border border-border p-3 tabular-nums">
      <div className="flex flex-wrap justify-between gap-2"><dt>Current claimable reward</dt><dd className="font-semibold">{formatEth(rewards)} ETH</dd></div>
      <div className="flex flex-wrap justify-between gap-2"><dt>Points</dt><dd>{formatScore(points)} → 0 PTS</dd></div>
      <div className="flex flex-wrap justify-between gap-2"><dt>Level</dt><dd>{level} → 1</dd></div>
    </dl>
  </div>;
}
