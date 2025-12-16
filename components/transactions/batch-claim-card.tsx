"use client";

import React, { useEffect, useState, useMemo } from 'react';
import Image from 'next/image';
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, AlertTriangle, Lock } from 'lucide-react';
import { Land } from '@/lib/types';
import { formatScore, formatLifetimeProduction } from '@/lib/utils';
import { getLandBuildingsBatch, LAND_CONTRACT_ADDRESS } from '@/lib/contracts';
import { landAbi } from '@/public/abi/pixotchi-v3-abi';
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

const MIN_PIXOTCHI_REQUIRED = Number(process.env.NEXT_PUBLIC_BATCH_CLAIM_MIN_TOKENS || 10);

// Maximum calls per batch to avoid tx simulation failures
// EIP-5792 + Smart Wallet practical limit: ~25-30 calls work reliably
// Beyond this, RPC simulation may timeout or gas estimation may fail
// Can be tuned via environment variable after testing with /api/admin/batch-limits
const MAX_BATCH_SIZE = Number(process.env.NEXT_PUBLIC_BATCH_CLAIM_MAX_SIZE || 25);

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

  // Calculate batch info
  const totalBatches = Math.ceil(claimableItems.length / MAX_BATCH_SIZE);
  const hasMultipleBatches = claimableItems.length > MAX_BATCH_SIZE;
  
  // Current batch is always the first MAX_BATCH_SIZE items
  // After each successful claim, we re-scan and the claimed items are removed
  const currentBatchItems = useMemo(() => 
    claimableItems.slice(0, MAX_BATCH_SIZE),
    [claimableItems]
  );

  // Total points/lifetime across ALL items (for display)
  const totalPoints = useMemo(() => 
    claimableItems.reduce((acc, item) => acc + item.points, BigInt(0)), 
    [claimableItems]
  );

  const totalLifetime = useMemo(() => 
    claimableItems.reduce((acc, item) => acc + item.lifetime, BigInt(0)), 
    [claimableItems]
  );

  // Current batch points/lifetime (what will be claimed this tx)
  const batchPoints = useMemo(() => 
    currentBatchItems.reduce((acc, item) => acc + item.points, BigInt(0)), 
    [currentBatchItems]
  );

  const batchLifetime = useMemo(() => 
    currentBatchItems.reduce((acc, item) => acc + item.lifetime, BigInt(0)), 
    [currentBatchItems]
  );

  // Only create calls for current batch
  const calls = useMemo(() => 
    currentBatchItems.map(item => ({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'villageClaimProduction',
      args: [item.landId, item.buildingId],
    })),
    [currentBatchItems]
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
    <Card className="rounded-2xl border-2 border-primary/20">
      <CardContent className="p-4 space-y-3">
        <div className="flex justify-between items-center pb-2 border-b border-border/50">
          <span className="font-semibold">Batch Claim</span>
          <div className="flex items-center gap-2">
            {hasMultipleBatches && (
              <span className="text-xs text-primary font-medium">
                Batch 1/{totalBatches}
              </span>
            )}
            <span className="text-xs text-muted-foreground">{claimableItems.length} Buildings</span>
          </div>
        </div>

        {/* Show totals for all items */}
        <div className="flex items-center justify-between gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Image src="/icons/pts.svg" alt="Points" width={16} height={16} className="w-4 h-4" />
            <span className="font-semibold text-green-600 dark:text-green-400">
              +{formatScore(Number(totalPoints))} PTS
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Image src="/icons/tod.svg" alt="Time of Death" width={16} height={16} className="w-4 h-4" />
            <span className="font-semibold text-blue-600 dark:text-blue-400">
              +{formatLifetimeProduction(totalLifetime)} TOD
            </span>
          </div>
        </div>

        {/* Multi-batch info */}
        {hasMultipleBatches && (
          <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-xs">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              <span>
                Large claim split into {totalBatches} batches of {MAX_BATCH_SIZE}. 
                This batch: {currentBatchItems.length} buildings ({formatScore(Number(batchPoints))} PTS)
              </span>
            </div>
          </div>
        )}

        {/* Gating Logic */}
        {!isSmartWallet ? (
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg space-y-2">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold text-xs">
              <Lock className="w-3 h-3" />
              Smart Wallet Required
            </div>
          </div>
        ) : !hasEnoughTokens ? (
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg space-y-1">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold text-xs">
              <Lock className="w-3 h-3" />
              {MIN_PIXOTCHI_REQUIRED} PIXOTCHI in wallet required to unlock batch claim.
            </div>
            <div className="text-[10px] font-mono text-muted-foreground">
              Balance: {pixotchiBalanceNum.toFixed(2)}
            </div>
          </div>
        ) : (
          <SmartWalletTransaction
            calls={calls}
            buttonText={hasMultipleBatches ? `Claim Batch (${currentBatchItems.length})` : "Claim All"}
            buttonClassName="w-full font-bold h-9 text-sm"
            onSuccess={(tx) => {
              const claimedCount = currentBatchItems.length;
              const remainingCount = claimableItems.length - claimedCount;
              
              if (remainingCount > 0) {
                toast.success(`Claimed ${claimedCount} buildings! ${remainingCount} remaining.`);
              } else {
                toast.success(`Claimed from all ${claimedCount} buildings!`);
              }
              
              scanLands(); // Re-scan to update remaining items
              if (onSuccess) onSuccess();
              window.dispatchEvent(new Event('balances:refresh'));
              window.dispatchEvent(new Event('buildings:refresh'));
            }}
            onError={(e) => toast.error("Batch claim failed")}
          />
        )}
      </CardContent>
    </Card>
  );
}
