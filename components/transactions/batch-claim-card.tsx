"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Coins, Clock, AlertTriangle, Lock } from 'lucide-react';
import { Land } from '@/lib/types';
import { getLandBuildingsBatch, LAND_CONTRACT_ADDRESS, landAbi } from '@/lib/contracts';
import { formatPlantPoints, formatPlantLifetime } from '@/lib/utils';
import SmartWalletTransaction from './smart-wallet-transaction';
import { StandardContainer } from '@/components/ui/pixel-container';
import { toast } from 'react-hot-toast';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { useBalances } from '@/lib/balance-context';
import { formatUnits } from 'viem';
import { Button } from '@/components/ui/button';

interface BatchClaimCardProps {
  lands: Land[];
  onSuccess?: () => void;
}

interface ClaimableItem {
  landId: bigint;
  buildingId: number;
  points: bigint;
  lifetime: bigint;
}

const MIN_PIXOTCHI_REQUIRED = 10;

export default function BatchClaimCard({ lands, onSuccess }: BatchClaimCardProps) {
  const [loading, setLoading] = useState(false);
  const [claimableItems, setClaimableItems] = useState<ClaimableItem[]>([]);
  const [lastScannedLandIds, setLastScannedLandIds] = useState<string>("");
  const { isSmartWallet } = useSmartWallet();
  const { pixotchiBalance } = useBalances();

  const pixotchiBalanceNum = parseFloat(formatUnits(pixotchiBalance, 18));
  const hasEnoughTokens = pixotchiBalanceNum >= MIN_PIXOTCHI_REQUIRED;
  
  // Memoize land IDs to detect changes
  const landIdsHash = useMemo(() => 
    lands.map(l => l.tokenId.toString()).sort().join(','), 
    [lands]
  );

  const scanLands = async () => {
    if (lands.length === 0) return;
    
    setLoading(true);
    try {
      const landIds = lands.map(l => l.tokenId);
      const results = await getLandBuildingsBatch(landIds);
      
      const items: ClaimableItem[] = [];
      
      results.forEach(result => {
        // Check village buildings (0: Solar, 3: Soil, 5: Bee)
        // Note: building IDs in result are from contract, so we iterate what we got
        result.villageBuildings.forEach((b: any) => {
          const id = Number(b.id);
          const points = BigInt(b.accumulatedPoints || 0);
          const lifetime = BigInt(b.accumulatedLifetime || 0);
          
          // Only include if there is something to claim
          // We target IDs 0, 3, 5 specifically as they are the production buildings
          if ((id === 0 || id === 3 || id === 5) && (points > BigInt(0) || lifetime > BigInt(0))) {
            items.push({
              landId: result.landId,
              buildingId: id,
              points,
              lifetime
            });
          }
        });
      });
      
      setClaimableItems(items);
      setLastScannedLandIds(landIdsHash);
    } catch (error) {
      console.error("Failed to batch scan lands:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Only scan if land list has changed
    if (landIdsHash !== lastScannedLandIds) {
      scanLands();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landIdsHash]);

  // Listen for global building refresh events to re-scan
  useEffect(() => {
    const handler = () => scanLands();
    window.addEventListener('buildings:refresh', handler);
    return () => window.removeEventListener('buildings:refresh', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lands]); // Re-bind if lands change, but scanLands uses current props/state

  const totalPoints = useMemo(() => 
    claimableItems.reduce((acc, item) => acc + item.points, BigInt(0)), 
    [claimableItems]
  );

  const totalLifetime = useMemo(() => 
    claimableItems.reduce((acc, item) => acc + item.lifetime, BigInt(0)), 
    [claimableItems]
  );

  const calls = useMemo(() => 
    claimableItems.map(item => ({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'villageClaimProduction',
      args: [item.landId, item.buildingId],
    })),
    [claimableItems]
  );

  if (loading && claimableItems.length === 0) {
    return (
      <Card className="rounded-2xl border-dashed">
        <CardContent className="py-6 flex justify-center items-center text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Scanning accumulated production...</span>
        </CardContent>
      </Card>
    );
  }

  // Hide if nothing to claim
  if (claimableItems.length === 0) {
    return null;
  }

  return (
    <Card className="rounded-2xl overflow-hidden border-2 border-primary/20">
      <div className="bg-primary/5 px-4 py-3 border-b border-primary/10 flex justify-between items-center">
        <h3 className="font-pixel text-sm font-bold flex items-center gap-2">
          🌱 Harvest Ready
        </h3>
        <span className="text-xs font-mono text-muted-foreground bg-background/50 px-2 py-1 rounded">
          {claimableItems.length} Sources
        </span>
      </div>
      
      <CardContent className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1 p-3 bg-muted/30 rounded-lg">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Coins className="w-3 h-3" /> Total PTS
            </span>
            <span className="text-lg font-bold font-mono text-green-600 dark:text-green-400">
              +{formatPlantPoints(totalPoints)}
            </span>
          </div>
          <div className="flex flex-col gap-1 p-3 bg-muted/30 rounded-lg">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" /> Total TOD
            </span>
            <span className="text-lg font-bold font-mono text-blue-600 dark:text-blue-400">
              +{formatPlantLifetime(totalLifetime)}
            </span>
          </div>
        </div>

        {/* Gating Logic */}
        {!isSmartWallet ? (
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg space-y-2">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold text-sm">
              <Lock className="w-4 h-4" />
              Smart Wallet Required
            </div>
            <p className="text-xs text-muted-foreground">
              Batch claiming is only available for Smart Wallets to ensure gas-efficient transactions.
            </p>
          </div>
        ) : !hasEnoughTokens ? (
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg space-y-2">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold text-sm">
              <Lock className="w-4 h-4" />
              Creator Coin Required
            </div>
            <p className="text-xs text-muted-foreground">
              You need at least {MIN_PIXOTCHI_REQUIRED} PIXOTCHI tokens to use this premium feature.
            </p>
            <div className="text-xs font-mono text-muted-foreground">
              Your balance: {pixotchiBalanceNum.toFixed(2)} PIXOTCHI
            </div>
          </div>
        ) : (
          <SmartWalletTransaction
            calls={calls}
            buttonText={`Claim All to Warehouses`}
            buttonClassName="w-full font-bold"
            onSuccess={(tx) => {
              toast.success(`Claimed from ${claimableItems.length} buildings!`);
              scanLands(); // Re-scan to clear the card
              if (onSuccess) onSuccess();
              window.dispatchEvent(new Event('balances:refresh'));
              window.dispatchEvent(new Event('buildings:refresh'));
            }}
            onError={(e) => toast.error("Batch claim failed")}
          />
        )}
        
        <p className="text-[10px] text-center text-muted-foreground/60">
          Claims production from Solar Panels, Soil Factories, and Bee Farms across all your lands.
        </p>
      </CardContent>
    </Card>
  );
}
