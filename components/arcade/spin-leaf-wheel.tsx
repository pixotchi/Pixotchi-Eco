"use client";

import { SPIN_LEAF_SEGMENTS, type useSpinLeafWheel } from "@/hooks/useSpinLeafWheel";
import type { SpinRewardPreview } from "@/lib/spin-metadata";
import { formatSignedSpinValue } from "@/lib/spin-result-recovery";
import { cn, formatDuration, formatScore, formatTokenAmount } from "@/lib/utils";

type SpinLeafWheelProps = {
  motion: ReturnType<typeof useSpinLeafWheel>;
  pending: boolean;
  rewards: readonly SpinRewardPreview[] | null;
};

function describeReward(reward: SpinRewardPreview): string {
  const parts: string[] = [];
  if (reward.pointsDelta !== 0) parts.push(`${formatSignedSpinValue(reward.pointsDelta, formatScore)} PTS`);
  if (reward.timeExtension !== 0) parts.push(`${formatSignedSpinValue(reward.timeExtension, formatDuration)} lifetime`);
  if (reward.leafAmount !== BigInt(0)) parts.push(`+${formatTokenAmount(reward.leafAmount)} LEAF`);
  return parts.length ? parts.join(" · ") : "No reward";
}

/** Decorative motion and its accessible, contract-derived outcome legend. */
export function SpinLeafWheel({ motion, pending, rewards }: SpinLeafWheelProps) {
  return <div className="space-y-4">
    <div className="relative mx-auto mt-6 flex h-56 w-56 items-center justify-center sm:h-60 sm:w-60">
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_32%,hsl(var(--scene-glow)/0.5)_0%,hsl(var(--scene-glow)/0.12)_48%,transparent_76%)] blur-xl" aria-hidden="true" />
      <div className="absolute inset-3 rounded-full border border-primary/15 bg-[conic-gradient(from_0deg,hsl(var(--primary)/0.16),hsl(var(--accent)/0.34),hsl(var(--scene-glow)/0.24),hsl(var(--primary)/0.16))] opacity-80 shadow-[var(--shadow-glow)]" aria-hidden="true" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative h-48 w-48 rounded-full border border-border/55 bg-card/90 bg-[image:var(--gradient-surface)] p-3 shadow-[0_24px_54px_-28px_hsl(var(--foreground)/0.5)] sm:h-56 sm:w-56" aria-hidden>
          <div
            ref={motion.rotorRef}
            className={cn(
              "absolute inset-4 flex items-center justify-center rounded-full border border-primary/35 bg-background/25 shadow-inner",
              motion.className,
            )}
            style={motion.style}
          >
            <svg viewBox="0 0 200 200" className="h-full w-full drop-shadow-sm">
              <circle cx="100" cy="100" r="88" fill="none" stroke="hsl(var(--primary) / 0.18)" strokeWidth="7" />
              <circle cx="100" cy="100" r="58" fill="none" stroke="hsl(var(--accent) / 0.22)" strokeWidth="2" />
              {[...Array(SPIN_LEAF_SEGMENTS)].map((_, index) => {
                // Match the confirmed index to the top pointer at the settle angle.
                const angle = index * 60 - 60;
                const radius = 68;
                const cx = 100 + Math.cos((angle * Math.PI) / 180) * radius;
                const cy = 100 + Math.sin((angle * Math.PI) / 180) * radius;
                const rotation = angle + 90;
                return (
                  <g key={index} transform={`rotate(${rotation} ${cx} ${cy})`}>
                    <image
                      href="/icons/spinleaf.png"
                      x={cx - 18}
                      y={cy - 18}
                      width={36}
                      height={36}
                      className="drop-shadow-sm"
                    />
                    <circle cx={cx} cy={cy - 20} r="8" fill="hsl(var(--background))" stroke="hsl(var(--primary) / 0.5)" />
                    <text x={cx} y={cy - 16} textAnchor="middle" fill="hsl(var(--foreground))" fontSize="11" fontWeight="700">{index + 1}</text>
                  </g>
                );
              })}
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-5 w-5 rounded-full border border-primary/35 bg-primary shadow-[0_0_18px_hsl(var(--primary)/0.32)]" />
            </div>
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-24 w-24 flex-col items-center justify-center space-y-1 rounded-full border border-primary/25 bg-card/80 bg-[image:var(--gradient-surface)] shadow-[var(--shadow-control)] backdrop-blur-[var(--blur-surface)]">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">SpinLeaf</span>
              <span className="text-xs font-bold text-primary">{pending ? "In motion" : "Good luck"}</span>
            </div>
          </div>
          <div className="absolute inset-0 rounded-full border border-white/15 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.25)]" />
        </div>
      </div>
      <div className="absolute top-2 left-1/2 z-10 -translate-x-1/2 flex flex-col items-center">
        <div className="h-4 w-5 rounded-b-[var(--radius-nav)] bg-primary shadow-[0_8px_18px_-10px_hsl(var(--primary)/0.8)]" />
        <div className="h-0 w-0 border-l-[10px] border-r-[10px] border-t-[16px] border-l-transparent border-r-transparent border-t-primary drop-shadow-sm" />
      </div>
    </div>
    <p className="text-xs text-muted-foreground">The animation is for fun. The contract determines the outcome; reveal timing does not improve your reward.</p>
    {rewards ? <section aria-label="SpinLeaf rewards" className="rounded-[var(--radius-panel)] border border-border/60 p-3">
      <h3 className="text-sm font-medium">Possible outcomes</h3>
      <ol aria-label="Possible SpinLeaf outcomes" className="mt-2 divide-y divide-border/60 text-xs">
        {rewards.map(reward => <li key={reward.index} className="flex items-start justify-between gap-3 py-2">
          <span className="shrink-0 text-muted-foreground">Outcome {reward.index + 1}</span>
          <span className="text-right font-medium">{describeReward(reward)}</span>
        </li>)}
      </ol>
    </section> : <p className="text-xs text-muted-foreground">Reward previews are unavailable until game details load.</p>}
  </div>;
}
