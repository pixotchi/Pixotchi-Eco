"use client";

import React, { useEffect, useState } from "react";
// Use native <img> for small icons to reduce overhead
import StakingDialog from "@/components/staking/staking-dialog";
import { Skeleton } from "./ui/skeleton";
import { useBalances } from "@/lib/balance-context";
import { formatUnits } from "viem";
import { useIsSolanaWallet, SolanaBridgeBadge, useSolanaWallet } from "@/components/solana";
import { getClientGamificationPolicy } from "@/lib/gamification-client";
import { onStakingDialogOpen, openTasksDialog } from "@/lib/app-events";

function formatTokenShort(amount: bigint, decimals: number = 18): string {
  const num = parseFloat(formatUnits(amount, decimals));
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') + "K";
  return num.toFixed(4).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export default function StatusBar() {
  const { seedBalance: seed, leafBalance: leaf, pixotchiBalance: pixotchi, loading } = useBalances();
  const isSolana = useIsSolanaWallet();
  const { solBalance } = useSolanaWallet();

  const [stakingOpen, setStakingOpen] = useState(false);
  const gamificationPolicy = getClientGamificationPolicy();
  const showTasksButton = !gamificationPolicy.disabled;

  // Balance refreshes are handled automatically by balance-context.tsx via events
  // No need for manual refresh on every render or tab change

  // (ETH balance removed) No separate refetch needed here

  // Allow other components to open the staking dialog (e.g., Stake House building)
  useEffect(() => {
    return onStakingDialogOpen(() => setStakingOpen(true));
  }, []);

  const seedValue = formatTokenShort(seed);
  const leafValue = formatTokenShort(leaf);
  const pixotchiValue = formatTokenShort(pixotchi);
  const seedText = loading ? <Skeleton className="h-5 w-20" /> : seedValue;
  const leafText = loading ? <Skeleton className="h-5 w-20" /> : leafValue;
  const pixotchiText = loading ? <Skeleton className="h-5 w-20" /> : pixotchiValue;
  const seedAriaLabel = loading ? "Seed balance loading" : `Seed balance: ${seedValue} SEED`;
  const leafAriaLabel = loading ? "Leaf balance loading" : `Leaf balance: ${leafValue} LEAF`;
  const pixotchiAriaLabel = loading ? "PIXOTCHI balance loading" : `PIXOTCHI balance: ${pixotchiValue}`;
  // SOL balance for Solana users (9 decimals)
  const solText = isSolana ? formatTokenShort(solBalance, 9) : null;

  const handleTasksClick = () => {
    openTasksDialog();
  };

  return (
    <div className="w-full bg-background" role="region" aria-label="Account balance and staking">
      <div className="host-chrome-stable-surface rounded-b-2xl border border-border/70 bg-card/95 px-4 py-1.5 shadow-sm backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0" role="group" aria-label="Token balances">
            {/* SOL balance - only for Solana users */}
            {isSolana && (
              <div className="flex items-center gap-1.5 min-w-0" aria-label={`SOL balance: ${solText} SOL`}>
                <img src="/icons/solana.svg" alt="" width={16} height={16} aria-hidden="true" />
                <span className="text-sm font-semibold tabular-nums truncate" aria-hidden="true">{solText}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 min-w-0" aria-label={seedAriaLabel}>
              <img src="/PixotchiKit/COIN.svg" alt="" width={16} height={16} aria-hidden="true" />
              <span className="text-sm font-semibold tabular-nums truncate" aria-hidden="true">{seedText}</span>
            </div>
            {/* LEAF only for non-Solana users (Solana users can't stake/earn LEAF) */}
            {!isSolana && (
              <div className="flex items-center gap-1.5 min-w-0" aria-label={leafAriaLabel}>
                <img src="/icons/leaf.png" alt="" width={16} height={16} aria-hidden="true" />
                <span className="text-sm font-semibold tabular-nums truncate" aria-hidden="true">{leafText}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 min-w-0" aria-label={pixotchiAriaLabel}>
              <img src="/icons/cc.png" alt="" width={16} height={16} aria-hidden="true" />
              <span className="text-sm font-semibold tabular-nums truncate" aria-hidden="true">{pixotchiText}</span>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {/* Show Solana badge when connected via Solana */}
            {isSolana && <SolanaBridgeBadge />}
            {showTasksButton && (
              <button
                type="button"
                onClick={handleTasksClick}
                className="inline-flex items-center justify-center px-2 py-0.5 text-xs leading-none whitespace-nowrap rounded-md bg-amber-600 text-white hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 btn-compact"
                aria-label="Open tasks"
                aria-haspopup="dialog"
              >
                Tasks
              </button>
            )}
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
    </div>
  );
}
