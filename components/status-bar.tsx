"use client";

import React, { useEffect, useState } from "react";
// Use native <img> for small icons to reduce overhead
import { useAccount } from "wagmi";
import StakingDialog from "@/components/staking/staking-dialog";
import { Skeleton } from "./ui/skeleton";
import { useBalances } from "@/lib/balance-context";
import { formatUnits } from "viem";
import { useIsSolanaWallet, SolanaBridgeBadge, useSolanaWallet } from "@/components/solana";
import { cn } from "@/lib/utils";

function formatTokenShort(amount: bigint, decimals: number = 18): string {
  const num = parseFloat(formatUnits(amount, decimals));
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1') + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(2).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1') + "K";
  return num.toFixed(4).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/, '');
}

export default function StatusBar({ refreshKey }: { refreshKey?: any }) {
  const { address } = useAccount();
  const { seedBalance: seed, leafBalance: leaf, pixotchiBalance: pixotchi, loading, refreshBalances } = useBalances();
  const isSolana = useIsSolanaWallet();
  const { twinInfo, solBalance } = useSolanaWallet();

  const [stakingOpen, setStakingOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  
  // Balance refreshes are handled automatically by balance-context.tsx via events
  // No need for manual refresh on every render or tab change

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

  const seedText = loading ? <Skeleton className="h-5 w-20" /> : formatTokenShort(seed);
  const leafText = loading ? <Skeleton className="h-5 w-20" /> : formatTokenShort(leaf);
  const pixotchiText = loading ? <Skeleton className="h-5 w-20" /> : formatTokenShort(pixotchi);
  // SOL balance for Solana users (9 decimals)
  const solText = isSolana ? formatTokenShort(solBalance, 9) : null;

  return (
    <div className="w-full bg-background" role="region" aria-label="Account balance and staking">
      <div className="rounded-b-2xl border border-border/70 bg-card/95 px-4 py-1.5 shadow-sm backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0" role="group" aria-label="Token balances">
            {/* SOL balance - only for Solana users */}
            {isSolana && (
              <div className="flex items-center gap-1.5 min-w-0" aria-label={`SOL balance: ${solText} SOL`}>
                <img src="/icons/solana.svg" alt="" width={16} height={16} aria-hidden="true" />
                <span className="text-sm font-semibold tabular-nums truncate" aria-hidden="true">{solText}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 min-w-0" aria-label={`Seed balance: ${seedText} SEED`}>
              <img src="/PixotchiKit/COIN.svg" alt="" width={16} height={16} aria-hidden="true" />
              <span className="text-sm font-semibold tabular-nums truncate" aria-hidden="true">{seedText}</span>
            </div>
            {/* LEAF only for non-Solana users (Solana users can't stake/earn LEAF) */}
            {!isSolana && (
            <div className="flex items-center gap-1.5 min-w-0" aria-label={`Leaf balance: ${leafText} LEAF`}>
              <img src="/icons/leaf.png" alt="" width={16} height={16} aria-hidden="true" />
              <span className="text-sm font-semibold tabular-nums truncate" aria-hidden="true">{leafText}</span>
            </div>
            )}
            <div className="flex items-center gap-1.5 min-w-0" aria-label={`PIXOTCHI balance: ${pixotchiText}`}>
              <img src="/icons/cc.png" alt="" width={16} height={16} aria-hidden="true" />
              <span className="text-sm font-semibold tabular-nums truncate" aria-hidden="true">{pixotchiText}</span>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {/* Show Solana badge when connected via Solana */}
            {isSolana && <SolanaBridgeBadge />}
            <button
              type="button"
              onClick={() => setTasksOpen(true)}
              className="inline-flex items-center justify-center px-2 py-0.5 text-xs leading-none whitespace-nowrap rounded-md bg-amber-600 text-white hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 btn-compact"
              aria-label="Open tasks"
              aria-expanded={tasksOpen}
              aria-haspopup="dialog"
            >
              Tasks
            </button>
            {/* Hide staking for Solana wallet users (not supported via bridge) */}
            {!isSolana && (
              <button
                type="button"
                onClick={() => setStakingOpen(true)}
                className="inline-flex items-center justify-center px-2 py-0.5 text-xs leading-none whitespace-nowrap rounded-md bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 btn-compact"
                aria-label="Open staking dialog"
                aria-expanded={stakingOpen}
                aria-haspopup="dialog"
              >
                Stake
              </button>
            )}
          </div>
        </div>
      </div>
      <StakingDialog open={stakingOpen} onOpenChange={setStakingOpen} />
      {tasksOpen && (
        <div className="sr-only" aria-hidden />
      )}
    </div>
  );
}


