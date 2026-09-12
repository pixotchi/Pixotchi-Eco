import Image from 'next/image';
import { cn } from '@/lib/utils';

/** Identity and metrics share the flexible column, leaving a stable action target. */
export function RankingPlantSummary({ name, level, isMine, points, stars, rewards, compact = true }: {
  name: string; level: number; isMine?: boolean; points: string; stars: number; rewards: string; compact?: boolean;
}) {
  return <div className={cn('min-w-0 py-1 [overflow-wrap:anywhere]', !compact && 'min-[520px]:flex min-[520px]:items-center min-[520px]:justify-between min-[520px]:gap-2')}>
    <div className="min-w-0 space-y-1">
    <h4 className="font-pixel text-sm leading-snug">{name}{isMine && <span className="ml-1 font-sans text-xs text-primary">(You)</span>}</h4>
    <p className="text-xs leading-tight text-muted-foreground">Level {level}</p>
    </div>
    <div className={cn('mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground', !compact && 'min-[520px]:mt-0 min-[520px]:justify-end')}>
      <span className="inline-flex items-center gap-1 text-foreground"><Image src="/icons/pts.svg" alt="" width={14} height={14} /><span className="font-semibold">{points}</span><span>PTS</span></span>
      <span className="inline-flex items-center gap-1"><Image src="/icons/Star.svg" alt="" width={14} height={14} /><span>{stars}</span><span>stars</span></span>
      <span className="inline-flex items-center gap-1"><Image src="/icons/ethlogo.svg" alt="" width={14} height={14} /><span>{rewards}</span><span>ETH</span></span>
    </div>
  </div>;
}
