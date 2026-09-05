"use client";

import { useMemo, useState } from 'react';
import { PlantAttackEmptyState } from '@/components/plant-attack-empty-state';
import { useDeadlineClock } from '@/hooks/useDeadlineClock';
import { canPlantAttack, getPlantAttackAvailability, getPlantAttackReadyAt, PLANT_TARGET_COOLDOWN_SECONDS, type AttackPlant } from '@/lib/plant-attack';

export function PlantAttackFixtures() {
  const [scenario, setScenario] = useState('cooldown');
  const [showAll, setShowAll] = useState(false);
  const [startedAt] = useState(() => Math.floor(Date.now() / 1000));
  const { owned, target } = useMemo(() => {
    const plant: AttackPlant = { id: 1, owner: 'player-a', level: 2, status: 0, lastAttackUsed: String(startedAt - 1800 + 3), lastAttacked: '0' };
    const target = { ...plant, id: 2, owner: 'player-b', level: scenario === 'no-targets' ? 1 : 3, lastAttackUsed: '0', lastAttacked: scenario === 'target-cooldown' ? String(startedAt - 3600 + 3) : '0' };
    if (scenario === 'empty') return { owned: [], target };
    if (scenario === 'dead') return { owned: [{ ...plant, status: 4 }], target };
    if (scenario === 'unavailable') return { owned: [{ ...plant, lastAttackUsed: 'invalid' }], target };
    if (scenario === 'mixed') return { owned: [plant, { ...plant, id: 3, lastAttackUsed: '0' }], target };
    return { owned: [{ ...plant, lastAttackUsed: ['no-targets','target-cooldown'].includes(scenario) ? '0' : plant.lastAttackUsed }], target };
  }, [scenario, startedAt]);
  const deadlines = useMemo(() => [
    ...owned.map(plant => getPlantAttackReadyAt(plant.lastAttackUsed) ?? 0),
    getPlantAttackReadyAt(target.lastAttacked, PLANT_TARGET_COOLDOWN_SECONDS) ?? 0,
  ], [owned, target]);
  const now = useDeadlineClock(deadlines);
  const canAttack = owned.some(plant => canPlantAttack(plant, target, now, false));
  return <section aria-label="Plant attack fixture" className="max-w-md space-y-3 rounded border bg-card p-3">
    <label className="block">Attack scenario<select aria-label="Attack scenario" className="ml-2 min-h-11 rounded border bg-background p-2" value={scenario} onChange={event => { setScenario(event.target.value); setShowAll(false); }}>
      {['cooldown','mixed','target-cooldown','no-targets','dead','empty','unavailable'].map(value => <option key={value}>{value}</option>)}
    </select></label>
    {canAttack || showAll ? <ul aria-label="Fixture targets"><li>Plant #2 — {canAttack ? 'Ready to attack' : 'Not eligible'}</li></ul>
      : <PlantAttackEmptyState availability={getPlantAttackAvailability(owned, now)} onRetry={() => setScenario('mixed')} onViewAll={() => setShowAll(true)} />}
  </section>;
}
