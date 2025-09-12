"use client";

import { useState, useEffect } from "react";
import { useAccount, useBalance } from "wagmi";
import Image from "next/image";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { formatTokenAmount, formatNumber } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useBalances } from "@/lib/balance-context";

import { StandardContainer } from "./ui/pixel-container";
import { formatUnits } from "viem";

// Format large numbers with M/K suffixes
function formatLargeNumber(amount: bigint): string {
  // Convert bigint to number directly (tokens are stored in wei, so divide by 1e18)
  const num = parseFloat(formatUnits(amount, 18));
  
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.?0+$/, '') + 'K';
  }
  
  // For smaller numbers, use the standard formatting
  return formatTokenAmount(amount);
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
    loading, 
    refreshBalances 
  } = useBalances();

  // ETH balance for wallet profile variant
  const {
    data: ethBalance,
    isLoading: ethLoading,
    refetch: refetchEthBalance,
  } = useBalance({
    address: address as `0x${string}`,
    query: { enabled: !!address && variant === "wallet-profile" }
  });

  const handleRefresh = async () => {
    if (variant === "wallet-profile") {
      refetchEthBalance();
    }
    await refreshBalances();
    if (onRefresh) onRefresh();
  };

  if (!address) return null;

  if (variant === "wallet-profile") {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">
            Balances
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={ethLoading || loading}
            aria-label="Refresh balances"
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${
                ethLoading || loading ? "animate-spin" : ""
              }`}
            />
            Refresh
          </Button>
        </div>

        {/* Single consolidated container listing ETH, SEED, LEAF */}
        <StandardContainer className="p-3 space-y-3 rounded-lg border bg-card">
          {/* ETH */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="text-lg">Ξ</span>
              <span className="text-sm font-medium">ETH</span>
            </div>
            <div className="text-right">
              {ethLoading ? (
                <Skeleton className="h-5 w-24" />
              ) : (
                <div className="text-sm font-mono">
                  {ethBalance ? parseFloat(ethBalance.formatted).toFixed(6) : "0.000000"}
                </div>
              )}
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* SEED */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Image src="/PixotchiKit/COIN.svg" alt="SEED" width={24} height={24} />
              <span className="text-sm font-medium">SEED</span>
            </div>
            <div className="text-right">
              {loading ? (
                <Skeleton className="h-5 w-20" />
              ) : (
                <div className="text-sm font-mono">{formatLargeNumber(tokenBalance)}</div>
              )}
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* LEAF */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Image src="/icons/leaf.png" alt="LEAF" width={24} height={24} />
              <span className="text-sm font-medium">LEAF</span>
            </div>
            <div className="text-right">
              {loading ? (
                <Skeleton className="h-5 w-20" />
              ) : (
                <div className="text-sm font-mono">{formatLargeNumber(leafBalance)}</div>
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
            {loading ? <Skeleton className="h-6 w-32" /> : `${formatLargeNumber(tokenBalance)} SEED`}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <Image src="/icons/leaf.png" alt="LEAF" width={20} height={20} />
          <span className="text-xl md:text-lg font-bold">
            {loading ? <Skeleton className="h-6 w-32" /> : `${formatLargeNumber(leafBalance)} LEAF`}
          </span>
        </div>
      </CardContent>
    </Card>
  );
} 