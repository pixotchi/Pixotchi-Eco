"use client";

import { Clock3, Flower2, Shield, Skull } from 'lucide-react';
import { useCountdown } from '@/hooks/useCountdown';
import type { PlantAttackAvailability } from '@/lib/plant-attack';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ResourceState } from '@/components/ui/resource-state';

function AttackCountdown({ readyAt }: { readyAt: number }) {
  const remaining = useCountdown(readyAt);
  return <span className="mt-3 block text-sm font-semibold text-foreground">
    Next attack in <span role="timer" aria-label="Time until your next attack" aria-live="off" className="tabular-nums">{remaining}</span>
  </span>;
}

export function PlantAttackEmptyState({ availability, loading, onRetry, onViewAll }: {
  availability: PlantAttackAvailability;
  loading?: boolean;
  onRetry: () => void;
  onViewAll: () => void;
}) {
  if (loading) return <ResourceState status="loading" title="Checking your plants" description="Checking which plants can attack and when their cooldowns end." />;
  if (availability.kind === 'unavailable') return <ResourceState status="error" title="Attack status unavailable" description="We could not check when your plants can attack. Refresh to try again." onRetry={onRetry} />;
  const copy = availability.kind === 'cooldown'
    ? { icon: Clock3, title: availability.livingCount === 1 ? 'Your plant is resting' : 'Your plants are resting', description: 'Each plant needs 30 minutes between attacks. Your next plant will be ready when the countdown ends.' }
    : availability.kind === 'no-plants'
      ? { icon: Flower2, title: 'No plants to attack with', description: 'Mint a plant first to attack other plants. Go to the Mint tab to get started.' }
      : availability.kind === 'no-living-plants'
        ? { icon: Skull, title: 'You need a living plant to attack', description: 'Your plants are dead. Revive one from My Plants or mint a new plant to start attacking again.' }
        : { icon: Shield, title: 'No eligible targets right now', description: 'Your plant must be a lower level than the target. Targets must belong to another player, be alive, have no active fence, and be at least 60 minutes past the last time they were attacked.' };
  return <EmptyState icon={copy.icon} title={copy.title}
    description={<>{copy.description}{availability.kind === 'cooldown' && <AttackCountdown readyAt={availability.readyAt} />}</>}
    action={<Button variant="outline" onClick={onViewAll}>View all plants</Button>} />;
}
