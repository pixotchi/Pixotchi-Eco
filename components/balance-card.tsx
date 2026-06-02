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
import { useEffect,useState } from "react";
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
    const walletRowClassName =
      "flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border/50 bg-background/55 px-3 py-2";
    const walletStackedRowClassName =
      "space-y-1 rounded-[var(--radius-control)] border border-border/50 bg-background/55 px-3 py-2";

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">
            Balances
          </h3>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={ethLoading || loading}
            aria-label="Refresh balances"
            className="btn-compact h-7 w-7 bg-background/60 p-0"
          >
            <RefreshCw
              className={`w-3 h-3 ${ethLoading || loading ? "animate-spin" : ""
                }`}
            />
          </Button>
        </div>

        {/* Consolidated container matching Connection card styling */}
        <StandardContainer className="space-y-2 rounded-[var(--radius-panel)] border border-border/80 bg-card/95 p-4 shadow-[var(--shadow-raised)]">
          {/* Network-specific balances */}
          {isSolana ? (
            <>
              {/* Native SOL */}
              <div className={walletRowClassName}>
                <span className="text-xs font-medium">Solana</span>
                <div className="flex items-center space-x-1">
                  {solanaLoading ? (
                    <Skeleton className="h-4 w-20" />
                  ) : (
                    <>
                      <span className="text-xs font-semibold">
                        {solBalance !== undefined ? formatSolAmount(solBalance) : "0"}
                      </span>
                      <Image src="/icons/solana.svg" alt="SOL" width={12} height={12} />
                    </>
                  )}
                </div>
              </div>

              {/* wSOL on Base (Twin) */}
              <div className={walletRowClassName}>
                <span className="text-xs font-medium">SOL (Base)</span>
                <div className="flex items-center space-x-1">
                  {solanaLoading ? (
                    <Skeleton className="h-4 w-20" />
                  ) : (
                    <>
                      <span className="text-xs font-semibold">
                        {twinInfo?.wsolBalance !== undefined ? formatSolAmount(twinInfo.wsolBalance) : "0"}
                      </span>
                      <Image src="/icons/solana.svg" alt="wSOL" width={12} height={12} />
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Ethereum */}
              <div className={walletRowClassName}>
                <span className="text-xs font-medium">Ethereum</span>
                <div className="flex items-center space-x-1">
                  {ethLoading ? (
                    <Skeleton className="h-4 w-20" />
                  ) : (
                    <>
                      <span className="text-xs font-semibold">
                        {ethBalance ? parseFloat(ethBalance.formatted).toFixed(6) : "0.000000"}
                      </span>
                      <Image src="/icons/ethlogo.svg" alt="ETH" width={12} height={12} />
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {/* SEED */}
          <div className={walletStackedRowClassName}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">SEED</span>
              <div className="flex items-center space-x-1">
                {loading ? (
                  <Skeleton className="h-4 w-20" />
                ) : (
                  <>
                    <span className="text-xs font-semibold">{formatLargeNumber(tokenBalance)}</span>
                    <Image src="/PixotchiKit/COIN.svg" alt="SEED" width={12} height={12} />
                  </>
                )}
              </div>
            </div>
            {/* Staked SEED sub-line */}
            {stakeInfo && stakeInfo.staked > BigInt(0) && (
              <div className="flex items-center justify-between pl-2">
                <span className="text-[10px] text-muted-foreground">Staked</span>
                <span className="text-[10px] text-muted-foreground">{formatLargeNumber(stakeInfo.staked)}</span>
              </div>
            )}
          </div>

          {/* LEAF */}
          <div className={walletStackedRowClassName}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">LEAF</span>
              <div className="flex items-center space-x-1">
                {loading ? (
                  <Skeleton className="h-4 w-20" />
                ) : (
                  <>
                    <span className="text-xs font-semibold">{formatLargeNumber(leafBalance)}</span>
                    <Image src="/icons/leaf.png" alt="LEAF" width={12} height={12} />
                  </>
                )}
              </div>
            </div>
            {/* Claimable LEAF sub-line */}
            {stakeInfo && stakeInfo.rewards > BigInt(0) && (
              <div className="flex items-center justify-between pl-2">
                <span className="text-[10px] text-muted-foreground">Claimable</span>
                <span className="text-[10px] text-muted-foreground">{formatLargeNumber(stakeInfo.rewards)}</span>
              </div>
            )}
          </div>

          {/* PIXOTCHI */}
          <div className={walletRowClassName}>
            <span className="text-xs font-medium">PIXOTCHI</span>
            <div className="flex items-center space-x-1">
              {loading ? (
                <Skeleton className="h-4 w-20" />
              ) : (
                <>
                  <span className="text-xs font-semibold">{formatLargeNumber(pixotchiBalance)}</span>
                  <Image src="/icons/cc.png" alt="PIXOTCHI" width={12} height={12} />
                </>
              )}
            </div>
          </div>

          {/* Separator before NFTs */}
          <div className="my-3 border-t border-border/70" />

          {/* Plants NFT Count */}
          <div className={walletRowClassName}>
            <span className="text-xs font-medium">Plants</span>
            <div className="flex items-center space-x-1">
              {nftLoading ? (
                <Skeleton className="h-4 w-12" />
              ) : (
                <>
                  <span className="text-xs font-semibold">{plantCount}</span>
                  <Image src="/icons/plant1.svg" alt="Plants" width={12} height={12} />
                </>
              )}
            </div>
          </div>

          {/* Lands NFT Count */}
          <div className={walletRowClassName}>
            <span className="text-xs font-medium">Lands</span>
            <div className="flex items-center space-x-1">
              {nftLoading ? (
                <Skeleton className="h-4 w-12" />
              ) : (
                <>
                  <span className="text-xs font-semibold">{landCount}</span>
                  <Image src="/icons/landIcon.png" alt="Lands" width={12} height={12} />
                </>
              )}
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
