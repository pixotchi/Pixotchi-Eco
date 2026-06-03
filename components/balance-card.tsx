"use client";

import { useIsSolanaWallet,useSolanaWallet } from "@/components/solana";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardHeader,CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBalances } from "@/lib/balance-context";
import { getLandsByOwner,getPlantsByOwner,getStakeInfo } from "@/lib/contracts";
import { formatSolAmount } from "@/lib/solana-bridge-executor";
import { formatLargeNumber } from "@/lib/utils";
import { RefreshCw } from "lucide-react";
import Image from "next/image";
import { type ReactNode,useEffect,useState } from "react";
import { useAccount,useBalance } from "wagmi";

import { StandardContainer } from "./ui/pixel-container";

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
  const { solBalance, twinInfo, isLoading: solanaLoading } = useSolanaWallet();

  // ETH balance for wallet profile variant (EVM only)
  const {
    data: ethBalance,
    isLoading: ethLoading,
    refetch: refetchEthBalance,
  } = useBalance({
    address: address as `0x${string}`,
    query: { enabled: !!address && variant === "wallet-profile" && !isSolana }
  });

  // Stake info for wallet profile variant
  const [stakeInfo, setStakeInfo] = useState<{ staked: bigint; rewards: bigint } | null>(null);
  const [, setStakeLoading] = useState(false);

  // NFT counts for wallet profile variant
  const [plantCount, setPlantCount] = useState<number>(0);
  const [landCount, setLandCount] = useState<number>(0);
  const [nftLoading, setNftLoading] = useState(false);

  useEffect(() => {
    if (variant !== "wallet-profile" || !address) return;

    const fetchWalletProfileData = async () => {
      setStakeLoading(true);
      setNftLoading(true);
      try {
        const [infoResult, plantsResult, landsResult] = await Promise.allSettled([
          getStakeInfo(address),
          getPlantsByOwner(address),
          getLandsByOwner(address)
        ]);

        if (infoResult.status === "fulfilled") {
          setStakeInfo(infoResult.value);
        }

        if (plantsResult.status === "fulfilled") {
          setPlantCount(plantsResult.value.length);
        }

        if (landsResult.status === "fulfilled") {
          setLandCount(landsResult.value.length);
        }

        if (
          infoResult.status === "rejected" &&
          plantsResult.status === "rejected" &&
          landsResult.status === "rejected"
        ) {
          throw infoResult.reason;
        }
      } catch (err) {
        console.error('Failed to fetch wallet profile data:', err);
        setStakeInfo(null);
      } finally {
        setStakeLoading(false);
        setNftLoading(false);
      }
    };

    fetchWalletProfileData();
  }, [address, variant]);

  const handleRefresh = async () => {
    if (variant === "wallet-profile" && !isSolana) {
      refetchEthBalance();
    }
    await refreshBalances();
    if (onRefresh) onRefresh();
  };

  if (!address && !isSolana) return null;

  if (variant === "wallet-profile") {
    const walletRowClassName = "flex min-h-7 items-center justify-between gap-3 px-1 py-0.5";
    const walletLabelClassName = "flex min-w-0 items-center gap-2";
    const walletValueClassName = "text-xs font-semibold tabular-nums text-foreground";
    const walletIconClassName = "h-4 w-4 shrink-0";
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
    }) => (
      <div className="space-y-0.5">
        <div className={walletRowClassName}>
          <div className={walletLabelClassName}>
            <Image src={iconSrc} alt={iconAlt} width={16} height={16} className={walletIconClassName} />
            <span className="truncate text-xs font-medium">{label}</span>
          </div>
          {isLoading ? (
            <Skeleton className={skeletonClassName} />
          ) : (
            <span className={walletValueClassName}>{value}</span>
          )}
        </div>
        {subLabel && subValue ? (
          <div className="ml-7 flex items-center justify-between gap-3 px-1 text-[10px] leading-none text-muted-foreground">
            <span>{subLabel}</span>
            <span className="tabular-nums">{subValue}</span>
          </div>
        ) : null}
      </div>
    );

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">
            Balances
          </h3>
          <Button
            variant="ghost"
            size="iconCompact"
            onClick={handleRefresh}
            disabled={ethLoading || loading}
            aria-label="Refresh balances"
            className="bg-background/60 p-0"
          >
            <RefreshCw
              className={`h-4 w-4 ${ethLoading || loading ? "animate-spin" : ""
                }`}
            />
          </Button>
        </div>

        <StandardContainer className="space-y-0.5 rounded-[var(--radius-panel)] border border-border/70 bg-background/45 p-2.5 shadow-[var(--shadow-hairline)]">
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

          <div className="my-1 border-t border-border/55 pt-1">
            {renderBalanceRow({
              label: "Plants",
              iconSrc: "/icons/plant1.svg",
              iconAlt: "Plants",
              value: plantCount,
              isLoading: nftLoading,
              skeletonClassName: "h-4 w-12",
            })}
            {renderBalanceRow({
              label: "Lands",
              iconSrc: "/icons/landIcon.png",
              iconAlt: "Lands",
              value: landCount,
              isLoading: nftLoading,
              skeletonClassName: "h-4 w-12",
            })}
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
