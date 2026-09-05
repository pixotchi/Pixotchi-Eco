"use client";

import Link from 'next/link';
import { openTasksDialog } from '@/lib/app-events';
import { Button } from './ui/button';
import { useSyncExternalStore } from 'react';
import { completeFirstCareStep, parseFirstCareProgress, readFirstCareProgress, subscribeFirstCareProgress } from '@/lib/first-care-progress';

/** Contextual help stays available without forcing a tutorial replay. */
export function FirstCareGuide({ hasPlant, urgent = false, owner }: { hasPlant: boolean; urgent?: boolean; owner?: string | null }) {
  const saved = useSyncExternalStore(subscribeFirstCareProgress, () => readFirstCareProgress(owner), () => '');
  const progress = parseFirstCareProgress(saved);
  if (hasPlant && progress.care && progress.tasks && !urgent) return null;
  return <details className="rounded-[var(--radius-panel)] border border-border bg-card p-4" open={!hasPlant || urgent || undefined}>
    <summary className="cursor-pointer text-sm font-semibold">{urgent ? 'Your plant needs care' : hasPlant ? 'Your next steps' : 'Start your farm'}</summary>
    <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-muted-foreground">
      <li>{hasPlant ? '✓ Plant acquired. Keep an eye on its remaining lifetime.' : <>Open <Link className="font-medium text-primary underline" href="/?tab=mint">Mint</Link> to check free-plant eligibility or compare paid strains. The review shows the required token and available balance. If you need SEED, visit <Link className="font-medium text-primary underline" href="/?tab=swap">Swap</Link>.</>}</li>
      <li>{progress.care && !urgent ? '✓ First care confirmed.' : 'Choose a care item to add lifetime or points. Review its cost and effect before buying.'}</li>
      <li>{progress.tasks ? '✓ Tasks explored. New challenges remain available from the Tasks button.' : <>Find a useful next challenge in <Button variant="link" className="h-auto p-0 align-baseline" onClick={() => { completeFirstCareStep(owner, 'tasks'); openTasksDialog(); }}>Farmer&apos;s Tasks</Button>.</>}</li>
    </ol>
  </details>;
}
