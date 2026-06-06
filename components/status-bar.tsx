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

function TasksRockIcon() {
  return (
    <Image
      src="/icons/Volcanic_Rock.svg"
      alt=""
      width={16}
      height={16}
      className="h-4 w-4 object-contain max-[340px]:h-3.5 max-[340px]:w-3.5"
      aria-hidden="true"
    />
  );
}

function StakeTokenCycleIcon() {
  return (
    <span className="status-token-cycle" aria-hidden="true">
      <Image
        src="/PixotchiKit/COIN.svg"
        alt=""
        width={16}
        height={16}
        className="stake-token-cycle-seed absolute inset-0 h-4 w-4 object-contain"
      />
      <Image
        src="/icons/leaf.png"
        alt=""
        width={16}
        height={16}
        className="stake-token-cycle-leaf absolute inset-0 h-4 w-4 object-contain"
      />
    </span>
  );
}

function trimCompactNumber(value: number, fractionDigits: number): string {
  return value.toFixed(fractionDigits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function formatTokenShort(amount: bigint, decimals: number = 18): string {
  const num = parseFloat(formatUnits(amount, decimals));
  if (!Number.isFinite(num) || num <= 0) return "0";
  if (num >= 1_000_000_000) return `${trimCompactNumber(num / 1_000_000_000, num >= 10_000_000_000 ? 0 : 1)}B`;
  if (num >= 1_000_000) return `${trimCompactNumber(num / 1_000_000, num >= 10_000_000 ? 0 : 1)}M`;
  if (num >= 100_000) return `${trimCompactNumber(num / 1_000, 0)}K`;
  if (num >= 1_000) return `${trimCompactNumber(num / 1_000, 1)}K`;
  if (num >= 999.5) return "1K";
  if (num >= 100) return trimCompactNumber(num, 0);
  if (num >= 10) return trimCompactNumber(num, 1);
  if (num >= 1) return trimCompactNumber(num, 2);
  if (num >= 0.01) return trimCompactNumber(num, 2);
  return "<.01";
}

function formatTokenDetailed(
  amount: bigint,
  decimals: number = 18,
  options: { maxFractionDigits?: number; smallValueDigits?: number } = {},
): string {
  const num = parseFloat(formatUnits(amount, decimals));
  if (!Number.isFinite(num) || num <= 0) return "0";

  const maxFractionDigits = options.maxFractionDigits ?? 2;
  const smallValueDigits = options.smallValueDigits ?? 4;
  const fractionDigits = num > 0 && num < 1 ? smallValueDigits : maxFractionDigits;
  const threshold = 1 / (10 ** fractionDigits);

  if (num > 0 && num < threshold) {
    return `<${threshold.toLocaleString("en-US", {
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: fractionDigits,
    })}`;
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: fractionDigits,
  }).format(num);
}

type StatusBarPlacement = "standalone" | "header";

export default function StatusBar({
  placement = "standalone",
  showEthInStandalone = false,
}: {
  placement?: StatusBarPlacement;
  showEthInStandalone?: boolean;
}) {
  const { seedBalance: seed, leafBalance: leaf, pixotchiBalance: pixotchi, loading } = useBalances();
  const { address } = useAccount();
  const isSolana = useIsSolanaWallet();
  const { solBalance } = useSolanaWallet();
  const isHeaderPlacement = placement === "header";
  const showEthBalance = (isHeaderPlacement || showEthInStandalone) && !isSolana;
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

  const useDetailedBalances = showEthBalance;
  const seedValue = useDetailedBalances ? formatTokenDetailed(seed, 18, { maxFractionDigits: 2 }) : formatTokenShort(seed);
  const leafValue = useDetailedBalances ? formatTokenDetailed(leaf, 18, { maxFractionDigits: 2 }) : formatTokenShort(leaf);
  const pixotchiValue = useDetailedBalances ? formatTokenDetailed(pixotchi, 18, { maxFractionDigits: 2 }) : formatTokenShort(pixotchi);
  const ethValue = ethBalance
    ? useDetailedBalances
      ? formatTokenDetailed(ethBalance.value, ethBalance.decimals, { maxFractionDigits: 5, smallValueDigits: 6 })
      : formatTokenShort(ethBalance.value, ethBalance.decimals)
    : "0";
  const balanceSkeletonClassName = "h-4 w-10 max-[340px]:h-3.5 max-[340px]:w-8";
  const seedText = loading ? <Skeleton className={balanceSkeletonClassName} /> : seedValue;
  const leafText = loading ? <Skeleton className={balanceSkeletonClassName} /> : leafValue;
  const pixotchiText = loading ? <Skeleton className={balanceSkeletonClassName} /> : pixotchiValue;
  const ethText = ethLoading ? <Skeleton className={balanceSkeletonClassName} /> : ethValue;
  const seedAriaLabel = loading ? "Seed balance loading" : `Seed balance: ${seedValue} SEED`;
  const leafAriaLabel = loading ? "Leaf balance loading" : `Leaf balance: ${leafValue} LEAF`;
  const pixotchiAriaLabel = loading ? "PIXOTCHI balance loading" : `PIXOTCHI balance: ${pixotchiValue}`;
  const ethAriaLabel = ethLoading ? "ETH balance loading" : `ETH balance: ${ethValue} ETH`;
  const balanceItemClassName = "flex min-w-0 shrink-0 items-center gap-1.5 max-[360px]:gap-1";
  const balanceTextClassName = "shrink-0 whitespace-nowrap text-[13px] font-bold leading-none tabular-nums max-[380px]:text-[11px] max-[340px]:text-[10px]";
  const balanceIconClassName = "h-[18px] w-[18px] shrink-0 max-[380px]:h-4 max-[380px]:w-4 max-[340px]:h-3.5 max-[340px]:w-3.5";
  const statusActionButtonClassName = "max-[380px]:h-8 max-[380px]:min-h-8 max-[380px]:px-2 max-[340px]:px-1.5 max-[340px]:text-[11px] max-[340px]:!gap-1";
  // SOL balance for Solana users (9 decimals)
  const solText = isSolana ? formatTokenShort(solBalance, 9) : null;

  const handleTasksClick = () => {
    openTasksDialog();
  };

  return (
    <div
      data-viewport-shell={!isHeaderPlacement ? "status" : undefined}
      className={isHeaderPlacement ? "shrink-0" : "w-full bg-transparent xl:flex xl:justify-end"}
      role="region"
      aria-label="Account balance and staking"
    >
      <div
        className={
          isHeaderPlacement
            ? "w-fit max-w-full px-0 py-0"
            : "app-status-scroll bg-transparent px-4 pb-2 pt-1.5 max-[380px]:px-2 max-[340px]:px-1.5 xl:mx-4 xl:mb-3 xl:w-fit xl:max-w-full xl:rounded-[var(--radius-panel)] xl:border xl:border-[hsl(var(--border-strong)/0.28)] xl:bg-secondary/70"
        }
      >
        <div className={isHeaderPlacement ? "flex items-center justify-start gap-3" : "flex w-full min-w-0 items-center justify-between gap-2 max-[380px]:gap-1.5 max-[340px]:gap-1 xl:justify-start"}>
          <div className={isHeaderPlacement ? "flex min-w-0 items-center gap-2" : "flex min-w-0 flex-1 items-center gap-2 max-[380px]:gap-1.5 max-[340px]:gap-1 xl:gap-3"} role="group" aria-label="Token balances">
            {/* SOL balance - only for Solana users */}
            {isSolana && (
              <div className={balanceItemClassName} aria-label={`SOL balance: ${solText} SOL`}>
                <Image src="/icons/solana.svg" alt="" width={18} height={18} className={balanceIconClassName} aria-hidden="true" />
                <span className={balanceTextClassName} aria-hidden="true">{solText}</span>
              </div>
            )}
            {showEthBalance && (
              <div className={balanceItemClassName} aria-label={ethAriaLabel}>
                <Image src="/icons/ethlogo.svg" alt="" width={18} height={18} className={balanceIconClassName} aria-hidden="true" />
                <span className={balanceTextClassName} aria-hidden="true">{ethText}</span>
              </div>
            )}
            <div className={balanceItemClassName} aria-label={seedAriaLabel}>
              <Image src="/PixotchiKit/COIN.svg" alt="" width={18} height={18} className={balanceIconClassName} aria-hidden="true" />
              <span className={balanceTextClassName} aria-hidden="true">{seedText}</span>
            </div>
            {/* LEAF only for non-Solana users (Solana users can't stake/earn LEAF) */}
            {!isSolana && (
              <div className={balanceItemClassName} aria-label={leafAriaLabel}>
                <Image src="/icons/leaf.png" alt="" width={18} height={18} className={balanceIconClassName} aria-hidden="true" />
                <span className={balanceTextClassName} aria-hidden="true">{leafText}</span>
              </div>
            )}
            <div className={balanceItemClassName} aria-label={pixotchiAriaLabel}>
              <Image src="/icons/cc.png" alt="" width={18} height={18} className={balanceIconClassName} aria-hidden="true" />
              <span className={balanceTextClassName} aria-hidden="true">{pixotchiText}</span>
            </div>
          </div>
          <div className={isHeaderPlacement ? "h-5 w-px bg-[hsl(var(--divider)/0.72)]" : "hidden h-5 w-px bg-[hsl(var(--divider)/0.72)] xl:block"} aria-hidden="true" />
          <div data-status-actions className="flex shrink-0 items-center gap-1.5 max-[380px]:gap-1">
            {/* Show Solana badge when connected via Solana */}
            {isSolana && <SolanaBridgeBadge />}
            {showTasksButton && (
              <Button
                type="button"
                onClick={handleTasksClick}
                variant="statusAction"
                size="status"
                leadingIcon={<TasksRockIcon />}
                className={statusActionButtonClassName}
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
                variant="statusAction"
                size="status"
                leadingIcon={<StakeTokenCycleIcon />}
                className={statusActionButtonClassName}
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
