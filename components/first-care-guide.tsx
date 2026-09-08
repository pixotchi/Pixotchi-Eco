"use client";

import Link from 'next/link';
import { openTasksDialog } from '@/lib/app-events';
import { Button } from './ui/button';
import { useSyncExternalStore } from 'react';
import { parseFirstCareProgress, readFirstCareProgress, subscribeFirstCareProgress } from '@/lib/first-care-progress';
import { getClientGamificationPolicy } from '@/lib/gamification-client';
import { navigateToGameTab } from '@/lib/game-navigation';

/** Contextual help stays available without forcing a tutorial replay. */
export function FirstCareGuide({ hasPlant, urgent = false, dead = false, onRevive, owner }: { hasPlant: boolean; urgent?: boolean; dead?: boolean; onRevive?: () => void; owner?: string | null }) {
  const saved = useSyncExternalStore(subscribeFirstCareProgress, () => readFirstCareProgress(owner), () => '');
  const progress = parseFirstCareProgress(saved);
  const policy = getClientGamificationPolicy();
  const tasksAvailable = policy.visible && policy.enabled;
  if (dead) return <div className="space-y-2 rounded-[var(--radius-panel)] border border-border bg-card p-4">
    <p className="text-sm font-semibold">Revive your plant first</p>
    <p className="text-sm leading-relaxed text-muted-foreground">Care items become available after revival. Review the SEED cost and your balance before reviving your plant.</p>
    {onRevive && <Button variant="outline" onClick={onRevive}>Review revival</Button>}
  </div>;
  if (hasPlant && progress.care && (progress.tasks || !tasksAvailable) && !urgent) return null;
  return <details className="rounded-[var(--radius-panel)] border border-border bg-card p-4" open={!hasPlant || urgent || undefined}>
    <summary className="cursor-pointer text-sm font-semibold">{urgent ? 'Your plant needs care' : hasPlant ? 'Your next steps' : 'Start your farm'}</summary>
    <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-muted-foreground">
      <li>{hasPlant ? '✓ Plant acquired. Keep an eye on its remaining lifetime.' : <>Open <Link className="font-medium text-primary underline" href="/?tab=mint">Mint</Link> to check free-plant eligibility or compare paid strains. The review shows the required token and available balance. If you need SEED, visit <Link className="font-medium text-primary underline" href="/?tab=swap">Swap</Link>.</>}</li>
      <li>{progress.care && !urgent ? '✓ First care confirmed.' : 'Choose a care item to add lifetime or points. Review its cost and effect before buying.'}</li>
      <li>{!tasksAvailable ? <>Tasks are unavailable right now. Explore <Button variant="link" className="h-auto p-0 align-baseline" onClick={() => navigateToGameTab('leaderboard')}>Ranking</Button> to see other players.</> : progress.tasks ? '✓ Tasks explored. New challenges remain available from the Tasks button.' : <>Find a useful next challenge in <Button variant="link" className="h-auto p-0 align-baseline" onClick={openTasksDialog}>Farmer&apos;s Tasks</Button>.</>}</li>
    </ol>
  </details>;
}
