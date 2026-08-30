"use client";

import { useIsSolanaWallet,useSolanaWallet } from "@/components/solana";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardHeader,CardTitle } from "@/components/ui/card";
import { RefreshIcon } from "@/components/ui/refresh-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { useBalances } from "@/lib/balance-context";
import { getLandsByOwner,getPlantsByOwner,getStakeInfo } from "@/lib/contracts";
import { formatSolAmount } from "@/lib/solana-bridge-executor";
import { cn,formatLargeNumber } from "@/lib/utils";
import Image from "next/image";
import { type ReactNode,useCallback,useEffect,useMemo,useRef,useState } from "react";
import { useAccount,useBalance } from "wagmi";

import { StandardContainer } from "./ui/pixel-container";

const MIN_REFRESH_FEEDBACK_MS = 650;

type StakeInfo = { staked: bigint; rewards: bigint } | null;

type WalletProfileResourceSnapshot = {
  ownerKey: string | null;
  stakeInfo: StakeInfo;
  plantCount: number | null;
  landCount: number | null;
  isLoading: boolean;
  error: string | null;
};

function createEmptyProfileSnapshot(
  ownerKey: string | null = null,
  isLoading = false,
): WalletProfileResourceSnapshot {
  return {
    ownerKey,
    stakeInfo: null,
    plantCount: null,
    landCount: null,
    isLoading,
    error: null,
  };
}

interface BalanceCardProps {
  className?: string;
  variant?: "default" | "wallet-profile";
  onRefresh?: () => void;
}

export default function BalanceCard({ className = "", variant = "default", onRefresh }: BalanceCardProps) {
  const { address } = useAccount();
  const {
    seedBalance: tokenBalance,
    leafBalance,
    pixotchiBalance,
    loading,
    refreshBalances
  } = useBalances();
  const isSolana = useIsSolanaWallet();
  const {
    effectiveAddress,
    solBalance,
    twinInfo,
    isLoading: solanaLoading,
  } = useSolanaWallet();
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const manualRefreshingRef = useRef(false);
  const manualRefreshGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  // ETH balance for wallet profile variant (EVM only)
  const {
    data: ethBalance,
    isLoading: ethLoading,
    refetch: refetchEthBalance,
  } = useBalance({
    address: address as `0x${string}`,
    query: { enabled: !!address && variant === "wallet-profile" && !isSolana }
  });

  // Solana-owned plants live at the Base Twin address. Key the snapshot by the
  // effective Base owner so switching auth surfaces cannot carry EVM profile data
  // into a Solana profile (or vice versa).
  const profileOwnerAddress = isSolana ? effectiveAddress : (address ?? null);
  const profileOwnerKey = variant === "wallet-profile" && profileOwnerAddress
    ? profileOwnerAddress.toLowerCase()
    : null;
  const profileOwnerKeyRef = useRef(profileOwnerKey);
  const profileRequestGenerationRef = useRef(0);
  profileOwnerKeyRef.current = profileOwnerKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      manualRefreshGenerationRef.current += 1;
      profileRequestGenerationRef.current += 1;
    };
  }, []);

  const [profileSnapshot, setProfileSnapshot] = useState<WalletProfileResourceSnapshot>(
    () => createEmptyProfileSnapshot(),
  );
  const visibleProfileSnapshot = useMemo(
    () => profileSnapshot.ownerKey === profileOwnerKey
      ? profileSnapshot
      : createEmptyProfileSnapshot(profileOwnerKey, Boolean(profileOwnerKey)),
    [profileOwnerKey, profileSnapshot],
  );

  const refreshProfileData = useCallback(async () => {
    const requestedOwner = profileOwnerAddress;
    const requestedOwnerKey = profileOwnerKey;

    if (!requestedOwner || !requestedOwnerKey) {
      if (mountedRef.current && profileOwnerKeyRef.current === requestedOwnerKey) {
        profileRequestGenerationRef.current += 1;
        setProfileSnapshot(createEmptyProfileSnapshot());
      }
      return;
    }

    if (!mountedRef.current || profileOwnerKeyRef.current !== requestedOwnerKey) return;
    const generation = profileRequestGenerationRef.current + 1;
    profileRequestGenerationRef.current = generation;
    setProfileSnapshot(createEmptyProfileSnapshot(requestedOwnerKey, true));

    const [infoResult, plantsResult, landsResult] = await Promise.allSettled([
      getStakeInfo(requestedOwner),
      getPlantsByOwner(requestedOwner),
      getLandsByOwner(requestedOwner),
    ]);

    if (
      profileRequestGenerationRef.current !== generation
      || !mountedRef.current
      || profileOwnerKeyRef.current !== requestedOwnerKey
    ) {
      return;
    }

    const failures = [infoResult, plantsResult, landsResult].filter(
      (result) => result.status === "rejected",
    );
    if (failures.length > 0) {
      console.warn('Some wallet profile resources could not be loaded', failures);
    }

    setProfileSnapshot({
      ownerKey: requestedOwnerKey,
      stakeInfo: infoResult.status === "fulfilled" ? infoResult.value : null,
      plantCount: plantsResult.status === "fulfilled" ? plantsResult.value.length : null,
      landCount: landsResult.status === "fulfilled" ? landsResult.value.length : null,
      isLoading: false,
      error: failures.length > 0
        ? 'Some ownership details are unavailable. Refresh to try again.'
        : null,
    });
  }, [profileOwnerAddress, profileOwnerKey]);

  useEffect(() => {
    void refreshProfileData();
    return () => {
      profileRequestGenerationRef.current += 1;
    };
  }, [refreshProfileData]);

  useEffect(() => {
    manualRefreshGenerationRef.current += 1;
    manualRefreshingRef.current = false;
    setManualRefreshing(false);
  }, [profileOwnerKey]);

  const {
    error: profileResourceError,
    isLoading: profileResourcesLoading,
    landCount,
    plantCount,
    stakeInfo,
  } = visibleProfileSnapshot;
  const nftLoading = profileResourcesLoading
    || (variant === "wallet-profile" && isSolana && !profileOwnerKey && solanaLoading);

  const handleRefresh = async () => {
    if (
      manualRefreshingRef.current
      || !mountedRef.current
      || profileOwnerKeyRef.current !== profileOwnerKey
    ) return;

    const requestedOwnerKey = profileOwnerKey;
    const generation = manualRefreshGenerationRef.current + 1;
    manualRefreshGenerationRef.current = generation;
    const startedAt = Date.now();
    manualRefreshingRef.current = true;
    setManualRefreshing(true);

    try {
      const refreshes: Promise<unknown>[] = [
        refreshBalances(),
        refreshProfileData(),
      ];
      if (variant === "wallet-profile" && !isSolana) {
        refreshes.push(refetchEthBalance());
      }
      if (onRefresh) refreshes.push(Promise.resolve(onRefresh()));
      await Promise.allSettled(refreshes);
    } finally {
      const remainingFeedbackMs = MIN_REFRESH_FEEDBACK_MS - (Date.now() - startedAt);
      if (remainingFeedbackMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingFeedbackMs));
      }
      if (
        manualRefreshGenerationRef.current === generation
        && mountedRef.current
        && profileOwnerKeyRef.current === requestedOwnerKey
      ) {
        manualRefreshingRef.current = false;
        setManualRefreshing(false);
      }
    }
  };

  if (!address && !isSolana) return null;

  if (variant === "wallet-profile") {
    const walletRowClassName =
      "flex min-h-11 items-center justify-between gap-3 py-2.5";
    const walletLabelClassName = "flex min-w-0 items-center gap-2.5";
    const walletValueClassName = "text-xs font-semibold tabular-nums text-foreground";
    const walletIconClassName = "h-5 w-5 shrink-0 object-contain";
    const walletGroupLabelClassName =
      "px-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
    const renderBalanceRow = ({
      label,
      iconSrc,
      iconAlt,
      value,
      isLoading = false,
      skeletonClassName = "h-4 w-20",
      subLabel,
      subValue,
    }: {
      label: string;
      iconSrc: string;
      iconAlt: string;
      value: ReactNode;
      isLoading?: boolean;
      skeletonClassName?: string;
      subLabel?: string;
      subValue?: ReactNode;
    }) => {
      const hasSubValue = Boolean(subLabel && subValue);

      return (
        <div className={cn(walletRowClassName, !hasSubValue && "min-h-9 py-1.5")}>
          <div className={walletLabelClassName}>
            <Image src={iconSrc} alt={iconAlt} width={20} height={20} className={walletIconClassName} />
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-foreground">{label}</span>
              {hasSubValue ? (
                <span className="mt-0.5 block truncate text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {subLabel}
                </span>
              ) : null}
            </span>
          </div>
          <div className={cn("flex min-w-0 max-w-[48%] flex-col items-end text-right", hasSubValue ? "gap-0.5" : "justify-center")}>
            {isLoading ? (
              <Skeleton className={cn(skeletonClassName, "rounded-[var(--radius-control)]")} />
            ) : (
              <span className={walletValueClassName}>{value}</span>
            )}
            {hasSubValue ? (
              <span className="max-w-full truncate text-[10px] font-semibold leading-none text-muted-foreground tabular-nums">
                {subValue}
              </span>
            ) : null}
          </div>
        </div>
      );
    };

    return (
      <div className={cn("space-y-3", className)}>
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center">
            <h3 className="truncate text-sm font-semibold text-foreground">
              Balances
            </h3>
          </div>
          <Button
            variant="surfaceControl"
            size="iconCompact"
            onClick={handleRefresh}
            disabled={ethLoading || loading || manualRefreshing}
            aria-label="Refresh balances"
            aria-busy={ethLoading || loading || manualRefreshing || undefined}
            className="h-8 min-h-8 w-8 min-w-8 p-0"
          >
            <RefreshIcon refreshing={ethLoading || loading || manualRefreshing} className="h-4 w-4" />
          </Button>
        </div>

        {profileResourceError ? (
          <p className="text-xs text-[hsl(var(--warning-strong))]" role="status">
            {profileResourceError}
          </p>
        ) : null}

        <StandardContainer className="chromatic-white-surface space-y-3 overflow-hidden rounded-[var(--radius-panel)] border border-[hsl(var(--edge-panel))] bg-card/95 bg-[image:var(--gradient-surface-strong)] p-3 shadow-[var(--shadow-raised)]">
          <div className="space-y-1">
            <div className={walletGroupLabelClassName}>Tokens</div>
            <div className="divide-y divide-border/55 border-b border-border/55">
              {isSolana ? (
                <>
                {renderBalanceRow({
                  label: "Solana",
                  iconSrc: "/icons/solana.svg",
                  iconAlt: "SOL",
                  value: solBalance !== undefined ? formatSolAmount(solBalance) : "0",
                  isLoading: solanaLoading,
                })}
                {renderBalanceRow({
                  label: "SOL (Base)",
                  iconSrc: "/icons/solana.svg",
                  iconAlt: "wSOL",
                  value: twinInfo?.wsolBalance !== undefined ? formatSolAmount(twinInfo.wsolBalance) : "0",
                  isLoading: solanaLoading,
                })}
                </>
              ) : (
                renderBalanceRow({
                  label: "Ethereum",
                  iconSrc: "/icons/ethlogo.svg",
                  iconAlt: "ETH",
                  value: ethBalance ? parseFloat(ethBalance.formatted).toFixed(6) : "0.000000",
                  isLoading: ethLoading,
                })
              )}

              {renderBalanceRow({
                label: "SEED",
                iconSrc: "/PixotchiKit/COIN.svg",
                iconAlt: "SEED",
                value: formatLargeNumber(tokenBalance),
                isLoading: loading,
                subLabel: stakeInfo && stakeInfo.staked > BigInt(0) ? "Staked" : undefined,
                subValue: stakeInfo && stakeInfo.staked > BigInt(0) ? formatLargeNumber(stakeInfo.staked) : undefined,
              })}
              {renderBalanceRow({
                label: "LEAF",
                iconSrc: "/icons/leaf.png",
                iconAlt: "LEAF",
                value: formatLargeNumber(leafBalance),
                isLoading: loading,
                subLabel: stakeInfo && stakeInfo.rewards > BigInt(0) ? "Claimable" : undefined,
                subValue: stakeInfo && stakeInfo.rewards > BigInt(0) ? formatLargeNumber(stakeInfo.rewards) : undefined,
              })}
              {renderBalanceRow({
                label: "PIXOTCHI",
                iconSrc: "/icons/cc.png",
                iconAlt: "PIXOTCHI",
                value: formatLargeNumber(pixotchiBalance),
                isLoading: loading,
              })}
            </div>
          </div>

          <div className="space-y-1 pt-2">
            <div className={walletGroupLabelClassName}>NFTs</div>
            <div className="divide-y divide-border/55">
              {renderBalanceRow({
                label: "Plants",
                iconSrc: "/icons/plant1.svg",
                iconAlt: "Plants",
                value: plantCount ?? "—",
                isLoading: nftLoading,
                skeletonClassName: "h-4 w-12",
              })}
              {renderBalanceRow({
                label: "Lands",
                iconSrc: "/icons/landIcon.png",
                iconAlt: "Lands",
                value: landCount ?? "—",
                isLoading: nftLoading,
                skeletonClassName: "h-4 w-12",
              })}
            </div>
          </div>
        </StandardContainer>
      </div>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Your Balance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center space-x-2">
          <Image src="/PixotchiKit/COIN.svg" alt="SEED" width={20} height={20} />
          <span className="text-xl md:text-lg font-bold">
            {loading ? <Skeleton className="h-6 w-40" /> : `${formatLargeNumber(tokenBalance)} SEED`}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <Image src="/icons/leaf.png" alt="LEAF" width={20} height={20} />
          <span className="text-xl md:text-lg font-bold">
            {loading ? <Skeleton className="h-6 w-40" /> : `${formatLargeNumber(leafBalance)} LEAF`}
          </span>
        </div>
      </CardContent>
    </Card>
  );
} 
