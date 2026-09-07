import Image from 'next/image';
import type { Land } from '@/lib/types';
import { formatDurationSeconds } from '@/lib/duration-display';
import { TokenAmount } from '@/components/ui/token-amount';

const badgeClass = 'flex max-w-full min-w-0 items-center gap-1 rounded-full border border-border/35 bg-card/75 px-2 py-0.5 shadow-[var(--shadow-hairline)] backdrop-blur-md';

/** The land snapshot contains the stored resources available through Warehouse. */
export function LandResourceBadges({ land }: {
  land: Pick<Land, 'accumulatedPlantPoints' | 'accumulatedPlantLifetime'>;
}) {
  const lifetime = formatDurationSeconds(land.accumulatedPlantLifetime);
  const exactLifetime = `${formatDurationSeconds(land.accumulatedPlantLifetime, 'exact')} lifetime`;
  return (
    <div role="group" aria-label="Available land resources"
      className="absolute bottom-3 right-3 z-20 flex max-w-[calc(100%-6rem)] flex-col items-end gap-1 text-xs font-bold text-foreground/80">
      <div className={badgeClass}>
        <Image src="/icons/pts.svg" alt="" width={16} height={16} className="h-4 w-4 shrink-0" />
        <TokenAmount amount={land.accumulatedPlantPoints} decimals={12} unit="PTS" mode="compact" className="min-w-0 text-right" withIcon={false} />
      </div>
      <div className={badgeClass} title={exactLifetime}>
        <Image src="/icons/tod.svg" alt="" width={16} height={16} className="h-4 w-4 shrink-0" />
        <span aria-label={exactLifetime} className="min-w-0 text-right tabular-nums [overflow-wrap:anywhere]">{lifetime}</span>
      </div>
    </div>
  );
}
