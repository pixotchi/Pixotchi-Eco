'use client';

import { ToggleGroup } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

export type PlantRankingFilter = 'all' | 'attackable' | 'dead';
export function RankingPlantFilters({ value, mine, canFilterMine, onChange, className }: {
  value: PlantRankingFilter; mine: boolean; canFilterMine: boolean;
  onChange: (filter: PlantRankingFilter, mine: boolean) => void; className?: string;
}) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>
    <ToggleGroup ariaLabel="Filter plants by status" value={value} onValueChange={next => {
      if (next !== 'all' && next !== 'attackable' && next !== 'dead') return;
      onChange(next, next === 'all' ? mine : false);
    }} options={[{ value: 'all', label: 'All' }, { value: 'attackable', label: 'Attackable' }, { value: 'dead', label: 'Dead' }]} />
    {canFilterMine && value !== 'attackable' && <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-1 text-sm">
      <input type="checkbox" checked={mine} onChange={event => onChange(value, event.target.checked)} className="h-5 w-5 rounded accent-primary" />
      <span className="text-muted-foreground">My Plants</span>
    </label>}
  </div>;
}
