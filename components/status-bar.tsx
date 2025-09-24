"use client";

import React, { useEffect, useState } from "react";
// Use native <img> for small icons to reduce overhead
import { useAccount } from "wagmi";
import StakingDialog from "@/components/staking/staking-dialog";
import { Skeleton } from "./ui/skeleton";
import { useBalances } from "@/lib/balance-context";
import { formatUnits } from "viem";

function formatTokenShort(amount: bigint): string {
  // 18 decimals tokens
  const num = parseFloat(formatUnits(amount, 18));
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1') + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(2).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1') + "K";
  return num.toFixed(4).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/, '');
}

export default function StatusBar({ refreshKey }: { refreshKey?: any }) {
  const { address } = useAccount();
  const { seedBalance: seed, leafBalance: leaf, loading, refreshBalances } = useBalances();

  const [stakingOpen, setStakingOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);

  // Refetch on tab change or external triggers
  useEffect(() => {
    refreshBalances();
  }, [refreshKey, refreshBalances]);

  // (ETH balance removed) No separate refetch needed here

  // Allow other components to open the staking dialog (e.g., Stake House building)
  useEffect(() => {
    const openStaking = () => setStakingOpen(true);
    window.addEventListener('staking:open', openStaking as EventListener);
    return () => window.removeEventListener('staking:open', openStaking as EventListener);
  }, []);

  // Open About tab's tasks modal via a global event so we reuse that UI
  useEffect(() => {
    if (!tasksOpen) return;
    try {
      window.dispatchEvent(new CustomEvent('pixotchi:openTasks' as any));
    } catch {}
    // Close flag after dispatch to avoid side-effects during render
    const t = setTimeout(() => setTasksOpen(false), 0);
    return () => clearTimeout(t);
  }, [tasksOpen]);

  const seedText = loading ? <Skeleton className="h-5 w-16" /> : formatTokenShort(seed);
  const leafText = loading ? <Skeleton className="h-5 w-16" /> : formatTokenShort(leaf);
  // ETH balance display removed to prioritize SEED and LEAF

  return (
    <div className="w-full" role="region" aria-label="Account balance and staking">
      <div className="flex items-center justify-between gap-3 px-4 py-1.5 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="flex items-center gap-4 min-w-0" role="group" aria-label="Token balances">
          <div className="flex items-center gap-1.5 min-w-0" aria-label={`Seed balance: ${seedText} SEED`}>
            <img src="/PixotchiKit/COIN.svg" alt="" width={16} height={16} aria-hidden="true" />
            <span className="text-sm font-semibold tabular-nums truncate" aria-hidden="true">{seedText}</span>
          </div>
          <div className="flex items-center gap-1.5 min-w-0" aria-label={`Leaf balance: ${leafText} LEAF`}>
            <img src="/icons/leaf.png" alt="" width={16} height={16} aria-hidden="true" />
            <span className="text-sm font-semibold tabular-nums truncate" aria-hidden="true">{leafText}</span>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTasksOpen(true)}
            className="inline-flex items-center justify-center px-2 py-0.5 text-xs leading-none whitespace-nowrap rounded-md bg-amber-600 text-white hover:bg-amber-700 btn-compact"
            aria-label="Open tasks"
            aria-expanded={tasksOpen}
            aria-haspopup="dialog"
          >
            Tasks
          </button>
          <button
            type="button"
            onClick={() => setStakingOpen(true)}
            className="inline-flex items-center justify-center px-2 py-0.5 text-xs leading-none whitespace-nowrap rounded-md bg-primary text-primary-foreground hover:bg-primary/90 btn-compact"
            aria-label="Open staking dialog"
            aria-expanded={stakingOpen}
            aria-haspopup="dialog"
          >
            Stake
          </button>
        </div>
      </div>
      <StakingDialog open={stakingOpen} onOpenChange={setStakingOpen} />
      {tasksOpen && (
        <div className="sr-only" aria-hidden />
      )}
    </div>
  );
}


