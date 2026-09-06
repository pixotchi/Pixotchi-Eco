"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { useStakingDialog } from './staking/staking-provider';
import { Skeleton } from "./ui/skeleton";
import { useBalances } from "@/lib/balance-context";
import { formatTokenDisplay, formatTokenDisplayCompact } from "@/lib/token-display";
import { useAccount, useBalance } from "wagmi";
import { useIsSolanaWallet, SolanaBridgeBadge, useSolanaWallet } from "@/components/solana";
import { getClientGamificationPolicy } from "@/lib/gamification-client";
import { openTasksDialog } from "@/lib/app-events";
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

const formatTokenShort = formatTokenDisplayCompact;
function formatTokenDetailed(amount: bigint, decimals = 18, options: { maxFractionDigits?: number; smallValueDigits?: number } = {}) {
  return formatTokenDisplay(amount, decimals, options.maxFractionDigits ?? 2);
}

type StatusBarPlacement = "standalone" | "header";

export default function StatusBar({
  placement = "standalone",
  showEthInStandalone = false,
}: {
  placement?: StatusBarPlacement;
  showEthInStandalone?: boolean;
}) {
  const {
    seedBalance: seed,
    leafBalance: leaf,
    pixotchiBalance: pixotchi,
    loading,
    seedBalanceStatus,
    leafBalanceStatus,
    pixotchiBalanceStatus,
    balanceError,
    refreshBalances,
  } = useBalances();
  const { address } = useAccount();
  const isSolana = useIsSolanaWallet();
  const {
    solBalance,
    isLoading: solanaLoading,
    error: solanaError,
    refresh: refreshSolana,
  } = useSolanaWallet();
  const isHeaderPlacement = placement === "header";
  const statusRootRef = React.useRef<HTMLDivElement>(null);
  // Lazy initial read so the ETH slot doesn't pop in a frame after first paint
  // (the old useState(true) start was corrected by an effect, shifting the row).
  const [useCompactStandaloneStatus, setUseCompactStandaloneStatus] = useState(
    () =>
      !isHeaderPlacement &&
      (typeof window === "undefined" ||
        !window.matchMedia?.("(min-width: 54rem)").matches),
  );
  const showEthBalance = (
    isHeaderPlacement ||
    (showEthInStandalone && !useCompactStandaloneStatus)
  ) && !isSolana;
  const {
    data: ethBalance,
    isLoading: ethLoading,
    isError: ethError,
    refetch: refetchEthBalance,
  } = useBalance({
    address,
    query: {
      enabled: showEthBalance && !!address,
      staleTime: 10_000,
      refetchInterval: 30_000,
    },
  });

  const { open: stakingOpen, openDialog: openStaking } = useStakingDialog();
  const gamificationPolicy = getClientGamificationPolicy();
  const showTasksButton = !gamificationPolicy.disabled;

  // Balance refreshes are handled automatically by balance-context.tsx via events
  // No need for manual refresh on every render or tab change

  const balanceReadPending = loading
    || seedBalanceStatus === 'unknown'
    || leafBalanceStatus === 'unknown'
    || pixotchiBalanceStatus === 'unknown'
    || (showEthBalance && ethLoading)
    || (isSolana && solanaLoading);
  const balanceReadError = Boolean(balanceError)
    || seedBalanceStatus === 'error'
    || leafBalanceStatus === 'error'
    || pixotchiBalanceStatus === 'error'
    || ethError
    || Boolean(solanaError);
  const balanceErrorMessage = balanceError instanceof Error
    ? balanceError.message
    : typeof balanceError === 'string' ? balanceError : null;
  const retryBalances = () => {
    void Promise.allSettled([
      refreshBalances(),
      ...(showEthBalance ? [refetchEthBalance()] : []),
      ...(isSolana ? [refreshSolana()] : []),
    ]);
  };

  useEffect(() => {
    if (isHeaderPlacement || typeof window === "undefined") {
      setUseCompactStandaloneStatus(false);
      return;
    }

    const syncCompactStatus = () => {
      const statusWidth = statusRootRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const isBelowTabletLayout = !window.matchMedia("(min-width: 54rem)").matches;
      // No orientation check: it unconditionally suppressed the detailed layout
      // in portrait, which cancelled showEthInStandalone on exactly the roomy
      // portrait viewports (tablets) it exists for. Width is the real constraint.
      setUseCompactStandaloneStatus(isBelowTabletLayout || statusWidth < 520);
    };

    syncCompactStatus();

    const resizeObserver = typeof ResizeObserver !== "undefined" && statusRootRef.current
      ? new ResizeObserver(syncCompactStatus)
      : null;

    resizeObserver?.observe(statusRootRef.current as Element);
    window.addEventListener("resize", syncCompactStatus);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncCompactStatus);
    };
  }, [isHeaderPlacement]);

  const useDetailedBalances = showEthBalance;
  const seedValue = seedBalanceStatus === 'ready'
    ? useDetailedBalances ? formatTokenDetailed(seed, 18, { maxFractionDigits: 2 }) : formatTokenShort(seed)
    : seedBalanceStatus === 'error' ? 'Unavailable' : 'Checking…';
  const leafValue = leafBalanceStatus === 'ready'
    ? useDetailedBalances ? formatTokenDetailed(leaf, 18, { maxFractionDigits: 2 }) : formatTokenShort(leaf)
    : leafBalanceStatus === 'error' ? 'Unavailable' : 'Checking…';
  const pixotchiValue = pixotchiBalanceStatus === 'ready'
    ? useDetailedBalances ? formatTokenDetailed(pixotchi, 18, { maxFractionDigits: 2 }) : formatTokenShort(pixotchi)
    : pixotchiBalanceStatus === 'error' ? 'Unavailable' : 'Checking…';
  const ethValue = ethBalance && !ethError
    ? useDetailedBalances
      ? formatTokenDetailed(ethBalance.value, ethBalance.decimals, { maxFractionDigits: 6, smallValueDigits: 6 })
      : formatTokenShort(ethBalance.value, ethBalance.decimals)
    : ethError ? "Unavailable" : "Checking…";
  const balanceSkeletonClassName = "h-4 w-10 max-[340px]:h-3.5 max-[340px]:w-8";
  const seedText = loading || seedBalanceStatus === 'unknown' ? <Skeleton className={balanceSkeletonClassName} /> : seedValue;
  const leafText = loading || leafBalanceStatus === 'unknown' ? <Skeleton className={balanceSkeletonClassName} /> : leafValue;
  const pixotchiText = loading || pixotchiBalanceStatus === 'unknown' ? <Skeleton className={balanceSkeletonClassName} /> : pixotchiValue;
  // Gate on undefined, not isLoading: when the query is disabled-then-enabled,
  // isLoading is briefly false with no data and the row flashed a literal "0".
  const ethText = ethLoading || ethBalance === undefined && !ethError
    ? <Skeleton className={balanceSkeletonClassName} />
    : ethValue;
  const balanceItemClassName = "flex min-w-0 shrink-0 items-center gap-1.5 max-[360px]:gap-1";
  const balanceTextClassName = "shrink-0 whitespace-nowrap text-xs font-bold leading-none tabular-nums max-[340px]:text-[11px]";
  const balanceIconClassName = "h-[18px] w-[18px] shrink-0 max-[380px]:h-4 max-[380px]:w-4 max-[340px]:h-3.5 max-[340px]:w-3.5";
  const statusActionButtonClassName = "px-2.5 max-tablet:h-8 max-tablet:min-h-8 max-tablet:py-1 max-[420px]:px-2 max-[420px]:!gap-1 max-[380px]:px-1.5 max-[340px]:text-[11px]";
  // SOL balance for Solana users (9 decimals)
  const solText = isSolana
    ? solanaLoading ? <Skeleton className={balanceSkeletonClassName} /> : solanaError ? 'Unavailable' : formatTokenShort(solBalance, 9)
    : null;

  const handleTasksClick = () => {
    openTasksDialog();
  };

  return (
    <div
      ref={statusRootRef}
      data-viewport-shell={!isHeaderPlacement ? "status" : undefined}
      /* In header placement this must be the element that gives way: it used to be
         shrink-0, so on a compact landscape phone (>=54rem wide, <=700px tall) it
         pushed the theme selector past the chrome wrapper's overflow:hidden edge
         once balances grew to 6+ digits. */
      className={isHeaderPlacement ? "min-w-0 shrink" : "w-full bg-transparent xl:flex xl:justify-end"}
      role="region"
      aria-label="Account balance and staking"
    >
      <div
        className={
          isHeaderPlacement
            ? "w-full min-w-0 max-w-full px-0 py-0"
            : "app-status-scroll bg-transparent px-4 pb-2 pt-1.5 max-[380px]:px-2 max-[340px]:px-1.5 xl:mx-4 xl:mb-3 xl:w-fit xl:max-w-full xl:rounded-[var(--radius-panel)] xl:border xl:border-[hsl(var(--border-strong)/0.28)] xl:bg-secondary/70"
        }
      >
        <div className={isHeaderPlacement ? "flex w-full min-w-0 items-center justify-start gap-3" : "flex w-full min-w-0 flex-wrap items-center justify-between gap-2 xl:justify-start"}>
          <div className={isHeaderPlacement ? "app-status-scroll flex min-w-0 items-center gap-2 overflow-x-auto" : "flex min-w-0 flex-wrap items-center gap-2 max-[340px]:gap-1 xl:gap-3"} role="group" aria-label="Token balances">
            {/* SOL balance - only for Solana users */}
            {isSolana && (
              <div className={balanceItemClassName}>
                <Image src="/icons/solana.svg" alt="" width={18} height={18} className={balanceIconClassName} aria-hidden="true" />
                <span className="sr-only">SOL balance </span>
                <span className={balanceTextClassName}>{solText}</span>
              </div>
            )}
            {showEthBalance && (
              <div className={balanceItemClassName}>
                <Image src="/icons/ethlogo.svg" alt="" width={18} height={18} className={balanceIconClassName} aria-hidden="true" />
                <span className="sr-only">ETH balance </span>
                <span className={balanceTextClassName}>{ethText}</span>
              </div>
            )}
            <div className={balanceItemClassName}>
              <Image src="/PixotchiKit/COIN.svg" alt="" width={18} height={18} className={balanceIconClassName} aria-hidden="true" />
              <span className="sr-only">SEED balance </span>
              <span className={balanceTextClassName}>{seedText}</span>
            </div>
            {/* LEAF only for non-Solana users (Solana users can't stake/earn LEAF) */}
            {!isSolana && (
              <div className={balanceItemClassName}>
                <Image src="/icons/leaf.png" alt="" width={18} height={18} className={balanceIconClassName} aria-hidden="true" />
                <span className="sr-only">LEAF balance </span>
                <span className={balanceTextClassName}>{leafText}</span>
              </div>
            )}
            <div className={balanceItemClassName}>
              <Image src="/icons/cc.png" alt="" width={18} height={18} className={balanceIconClassName} aria-hidden="true" />
              <span className="sr-only">PIXOTCHI balance </span>
              <span className={balanceTextClassName}>{pixotchiText}</span>
            </div>
          </div>
          <div className={isHeaderPlacement ? "h-5 w-px bg-[hsl(var(--divider)/0.72)]" : "hidden h-5 w-px bg-[hsl(var(--divider)/0.72)] xl:block"} aria-hidden="true" />
          <div data-status-actions className="flex shrink-0 items-center gap-1.5 max-[420px]:gap-1">
            {balanceReadError && !balanceReadPending && (
              <Button
                type="button"
                onClick={retryBalances}
                variant="statusAction"
                size="touchCompact"
                className={statusActionButtonClassName}
                aria-label="Retry balance reads"
                title={balanceErrorMessage || 'Retry balance reads'}
              >
                Retry
              </Button>
            )}
            {/* Show Solana badge when connected via Solana */}
            {isSolana && <SolanaBridgeBadge />}
            {showTasksButton && (
              <Button
                type="button"
                onClick={handleTasksClick}
                variant="statusAction"
                size="touchCompact"
                leadingIcon={<TasksRockIcon />}
                className={statusActionButtonClassName}
                aria-label="Open tasks"
                aria-haspopup="dialog"
              >
                <span>Tasks</span>
              </Button>
            )}
            {/* Hide staking for Solana wallet users (not supported via bridge) */}
            {!isSolana && (
              <Button
                type="button"
                onClick={openStaking}
                variant="statusAction"
                size="touchCompact"
                leadingIcon={<StakeTokenCycleIcon />}
                className={statusActionButtonClassName}
                aria-label="Open staking dialog"
                aria-expanded={stakingOpen}
                aria-haspopup="dialog"
              >
                <span>Stake</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
