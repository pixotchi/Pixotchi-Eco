import type { BuildingData } from '@/lib/types';
import { formatDurationSeconds } from '@/lib/duration-display';
import { TokenAmount } from '@/components/ui/token-amount';
import { getVillageProductionRates } from '@/lib/land-production';

export function ProductionSummary({ building }: { building: Pick<BuildingData, 'level' | 'isUpgrading' | 'productionRatePlantPointsPerDay' | 'productionRatePlantLifetimePerDay' | 'accumulatedPoints' | 'accumulatedLifetime'> }) {
  const production = getVillageProductionRates(building);
  const rows = [
    { label: 'Points per day', amount: production.pointsPerDay, kind: 'points' },
    { label: 'Lifetime per day', amount: production.lifetimePerDaySeconds, kind: 'lifetime' },
    { label: 'Stored points', amount: building.accumulatedPoints, kind: 'points' },
    { label: 'Stored lifetime', amount: building.accumulatedLifetime, kind: 'lifetime' },
  ].filter(row => row.amount > BigInt(0));
  return <dl className="space-y-3 text-sm">
    {rows.map(row => <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <dt className="text-muted-foreground">{row.label}</dt>
      <dd className="min-w-0 font-medium tabular-nums [overflow-wrap:anywhere]">
        {row.kind === 'points' ? <TokenAmount amount={row.amount} decimals={12} unit="PTS" /> : <span title={formatDurationSeconds(row.amount, 'exact')}>{formatDurationSeconds(row.amount)}</span>}
      </dd>
    </div>)}
  </dl>;
}
