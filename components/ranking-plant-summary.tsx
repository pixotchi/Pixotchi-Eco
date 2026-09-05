import Image from 'next/image';

/** Identity and metrics share the flexible column, leaving a stable action target. */
export function RankingPlantSummary({ name, level, isMine, points, stars, rewards }: {
  name: string; level: number; isMine?: boolean; points: string; stars: number; rewards: string;
}) {
  return <div className="min-w-0 space-y-1 py-1 [overflow-wrap:anywhere]">
    <h4 className="font-pixel text-sm leading-snug">{name}{isMine && <span className="ml-1 font-sans text-xs text-primary">(You)</span>}</h4>
    <p className="text-[11px] leading-tight text-muted-foreground">LvL {level}</p>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
      <span className="inline-flex items-center gap-1 text-foreground"><Image src="/icons/pts.svg" alt="Points" width={12} height={12} /><span className="font-semibold">{points}</span></span>
      <span className="inline-flex items-center gap-1"><Image src="/icons/Star.svg" alt="Stars" width={11} height={11} /><span>{stars}</span></span>
      <span className="inline-flex items-center gap-1"><Image src="/icons/ethlogo.svg" alt="ETH" width={11} height={11} /><span>{rewards}</span></span>
    </div>
  </div>;
}
