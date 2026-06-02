"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import StakingDialog from "@/components/staking/staking-dialog";
import { Skeleton } from "./ui/skeleton";
import { useBalances } from "@/lib/balance-context";
import { formatUnits } from "viem";
import { useAccount, useBalance } from "wagmi";
import { useIsSolanaWallet, SolanaBridgeBadge, useSolanaWallet } from "@/components/solana";
import { getClientGamificationPolicy } from "@/lib/gamification-client";
import { onStakingDialogOpen, openTasksDialog } from "@/lib/app-events";
import { Button } from "./ui/button";

function formatTokenShort(amount: bigint, decimals: number = 18): string {
  const num = parseFloat(formatUnits(amount, decimals));
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') + "K";
  return num.toFixed(4).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

type StatusBarPlacement = "standalone" | "header";

export default function StatusBar({ placement = "standalone" }: { placement?: StatusBarPlacement }) {
  const { seedBalance: seed, leafBalance: leaf, pixotchiBalance: pixotchi, loading } = useBalances();
  const { address } = useAccount();
  const isSolana = useIsSolanaWallet();
  const { solBalance } = useSolanaWallet();
  const isHeaderPlacement = placement === "header";
  const showEthBalance = isHeaderPlacement && !isSolana;
  const { data: ethBalance, isLoading: ethLoading } = useBalance({
    address,
    query: {
      enabled: showEthBalance && !!address,
      staleTime: 10_000,
      refetchInterval: 30_000,
    },
  });

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
  const ethValue = ethBalance ? formatTokenShort(ethBalance.value, ethBalance.decimals) : "0";
  const seedText = loading ? <Skeleton className="h-5 w-20" /> : seedValue;
  const leafText = loading ? <Skeleton className="h-5 w-20" /> : leafValue;
  const pixotchiText = loading ? <Skeleton className="h-5 w-20" /> : pixotchiValue;
  const ethText = ethLoading ? <Skeleton className="h-5 w-16" /> : ethValue;
  const seedAriaLabel = loading ? "Seed balance loading" : `Seed balance: ${seedValue} SEED`;
  const leafAriaLabel = loading ? "Leaf balance loading" : `Leaf balance: ${leafValue} LEAF`;
  const pixotchiAriaLabel = loading ? "PIXOTCHI balance loading" : `PIXOTCHI balance: ${pixotchiValue}`;
  const ethAriaLabel = ethLoading ? "ETH balance loading" : `ETH balance: ${ethValue} ETH`;
  // SOL balance for Solana users (9 decimals)
  const solText = isSolana ? formatTokenShort(solBalance, 9) : null;

  const handleTasksClick = () => {
    openTasksDialog();
  };

  return (
    <div
      data-viewport-shell={!isHeaderPlacement ? "status" : undefined}
      className={isHeaderPlacement ? "shrink-0" : "w-full bg-background xl:flex xl:justify-end xl:bg-transparent"}
      role="region"
      aria-label="Account balance and staking"
    >
      <div
        className={
          isHeaderPlacement
            ? "w-fit max-w-full rounded-lg border border-border/70 bg-background/60 px-3 py-1 shadow-none backdrop-blur-md"
            : "app-status-scroll rounded-b-2xl border border-border/70 bg-card/95 px-4 py-1.5 shadow-sm backdrop-blur-md xl:mx-4 xl:mb-3 xl:w-fit xl:max-w-full xl:rounded-lg xl:bg-background/60 xl:shadow-none"
        }
      >
        <div className={isHeaderPlacement ? "flex items-center justify-start gap-3" : "flex items-center justify-between gap-3 xl:justify-start"}>
          <div className={isHeaderPlacement ? "flex min-w-0 items-center gap-2" : "flex items-center gap-2 min-w-0 xl:gap-3"} role="group" aria-label="Token balances">
            {/* SOL balance - only for Solana users */}
            {isSolana && (
              <div className="flex items-center gap-1.5 min-w-0" aria-label={`SOL balance: ${solText} SOL`}>
                <Image src="/icons/solana.svg" alt="" width={16} height={16} aria-hidden="true" />
                <span className="text-sm font-semibold tabular-nums truncate" aria-hidden="true">{solText}</span>
              </div>
            )}
            {showEthBalance && (
              <div className="flex items-center gap-1.5 min-w-0" aria-label={ethAriaLabel}>
                <Image src="/icons/ethlogo.svg" alt="" width={16} height={16} aria-hidden="true" />
                <span className="text-sm font-semibold tabular-nums truncate" aria-hidden="true">{ethText}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 min-w-0" aria-label={seedAriaLabel}>
              <Image src="/PixotchiKit/COIN.svg" alt="" width={16} height={16} aria-hidden="true" />
              <span className="text-sm font-semibold tabular-nums truncate" aria-hidden="true">{seedText}</span>
            </div>
            {/* LEAF only for non-Solana users (Solana users can't stake/earn LEAF) */}
            {!isSolana && (
              <div className="flex items-center gap-1.5 min-w-0" aria-label={leafAriaLabel}>
                <Image src="/icons/leaf.png" alt="" width={16} height={16} aria-hidden="true" />
                <span className="text-sm font-semibold tabular-nums truncate" aria-hidden="true">{leafText}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 min-w-0" aria-label={pixotchiAriaLabel}>
              <Image src="/icons/cc.png" alt="" width={16} height={16} aria-hidden="true" />
              <span className="text-sm font-semibold tabular-nums truncate" aria-hidden="true">{pixotchiText}</span>
            </div>
          </div>
          <div className={isHeaderPlacement ? "h-5 w-px bg-border/70" : "hidden h-5 w-px bg-border/70 xl:block"} aria-hidden="true" />
          <div data-status-actions className="shrink-0 flex items-center gap-2">
            {/* Show Solana badge when connected via Solana */}
            {isSolana && <SolanaBridgeBadge />}
            {showTasksButton && (
              <Button
                type="button"
                onClick={handleTasksClick}
                variant="warning"
                size="touchCompact"
                className="btn-touch-compact px-2"
                aria-label="Open tasks"
                aria-haspopup="dialog"
              >
                Tasks
              </Button>
            )}
            {/* Hide staking for Solana wallet users (not supported via bridge) */}
            {!isSolana && (
              <Button
                type="button"
                onClick={() => setStakingOpen(true)}
                variant="primary"
                size="touchCompact"
                className="btn-touch-compact px-2"
                aria-label="Open staking dialog"
                aria-expanded={stakingOpen}
                aria-haspopup="dialog"
              >
                Stake
              </Button>
            )}
          </div>
        </div>
      </div>
      <StakingDialog open={stakingOpen} onOpenChange={setStakingOpen} />
    </div>
  );
}
