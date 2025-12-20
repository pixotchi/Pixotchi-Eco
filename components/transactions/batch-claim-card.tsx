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
import { formatUnits, parseUnits, erc20Abi } from 'viem';
import { Button } from '@/components/ui/button';
import { useAccount } from 'wagmi';
import { extractTransactionHash } from '@/lib/transaction-utils';

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

// Burn configuration
const BURN_AMOUNT_TOKENS = Number(process.env.NEXT_PUBLIC_BATCH_CLAIM_BURN_AMOUNT || 500);
const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const PIXOTCHI_TOKEN_ADDRESS = '0xa2ef17bb7eea1143196678337069dfa24d37d2ac'; // PIXOTCHI Token (CREATOR_TOKEN_ADDRESS)

// Minimum accumulated amounts to include in batch claim
// Buildings constantly produce, so after claiming they quickly have tiny amounts
// Filter out dust to avoid re-claiming immediately after a batch
//
// Production rate math (from building-info-dialog.tsx):
//   PTS: Solar Panels L4 = 85 PTS/day (max) → 0.059 PTS/minute
//        Soil Factory L3 = 61 PTS/day → 0.042 PTS/minute
//        Threshold 0.1 PTS → ~1.7 minutes minimum wait at max
//   TOD: Bee Farm L3 = 4.5h/day = 16,200 sec/day → 11.25 sec/minute
//        Threshold 15 sec → ~1.3 minutes minimum wait at max
//
// Points are in 1e12 units (1 PTS = 1e12), Lifetime in seconds
const MIN_POINTS_TO_CLAIM = BigInt(1e11); // 0.1 PTS minimum (~1.7 min for max producers)
const MIN_LIFETIME_TO_CLAIM = BigInt(15); // 15 seconds of TOD minimum (~1.3 min for max)

// Maximum calls per batch to avoid tx simulation failures
// 
// Key constraints (tested with /api/admin/batch-limits):
// 1. Per-transaction gas limit: 16.77M (post-Fusaka EIP-7825 on Base)
// 2. Each villageClaimProduction uses ~78,700 gas (empirically measured)
// 3. Smart wallet bundler adds ~21k base + ~5k per call overhead
// 4. Gas math: 16.77M / 78.7k ≈ 213 calls max (hard limit)
// 5. RPC simulation may timeout before gas limit is reached
// 
// Testing progression:
//   50 calls  = ~4M gas  (24%) - very safe
//   100 calls = ~8M gas  (48%) - confirmed working
//   150 calls = ~12M gas (71%) - current default
//   200 calls = ~16M gas (95%) - max, risky
// 
// Default 150: balances UX (2-3 batches for whales) vs reliability
// Tune via NEXT_PUBLIC_BATCH_CLAIM_MAX_SIZE if simulation fails
const MAX_BATCH_SIZE = Number(process.env.NEXT_PUBLIC_BATCH_CLAIM_MAX_SIZE || 150);

export default function BatchClaimCard({ lands, onSuccess }: BatchClaimCardProps) {
  const [loading, setLoading] = useState(false);
  const [claimableItems, setClaimableItems] = useState<ClaimableItem[]>([]);
  const [lastScannedLandIds, setLastScannedLandIds] = useState<string>("");
  // Track total claimed across batches for progress display
  const [totalClaimedThisSession, setTotalClaimedThisSession] = useState(0);
  // Key to force re-mount of Transaction component after each batch (resets button state)
  const [txKey, setTxKey] = useState(0);
  const { isSmartWallet } = useSmartWallet();
  const { pixotchiBalance } = useBalances();
  const { address } = useAccount();

  const pixotchiBalanceNum = parseFloat(formatUnits(pixotchiBalance, 18));
  const burnAmountWei = parseUnits(BURN_AMOUNT_TOKENS.toString(), 18);
  const hasEnoughTokens = pixotchiBalance >= burnAmountWei;
  
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
          
          // Only include if there is meaningful amount to claim
          // We target IDs 0, 3, 5 specifically as they are the production buildings
          // Use minimum thresholds to filter out dust (buildings accumulate constantly)
          const hasEnoughPoints = points >= MIN_POINTS_TO_CLAIM;
          const hasEnoughLifetime = lifetime >= MIN_LIFETIME_TO_CLAIM;
          
          if ((id === 0 || id === 3 || id === 5) && (hasEnoughPoints || hasEnoughLifetime)) {
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
      setTotalClaimedThisSession(0); // Reset progress for new session
      setTxKey(0); // Reset transaction component key
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
  const calls = useMemo(() => {
    // 1. Burn transaction (First call in batch)
    const burnCall = {
      address: PIXOTCHI_TOKEN_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [BURN_ADDRESS as `0x${string}`, burnAmountWei],
    };

    // 2. Claim transactions
    const claimCalls = currentBatchItems.map(item => ({
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: 'villageClaimProduction',
      args: [item.landId, item.buildingId],
    }));

    return [burnCall, ...claimCalls];
  }, [currentBatchItems, burnAmountWei]);

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
          <div className="flex items-center gap-2 text-xs">
            {totalClaimedThisSession > 0 && (
              <span className="text-green-700 dark:text-green-400 font-medium">
                ✓ {totalClaimedThisSession} claimed
              </span>
            )}
            <span className="text-muted-foreground">
              {claimableItems.length} buildings remaining
            </span>
          </div>
        </div>

        {/* Show totals for all items */}
        <div className="flex items-center justify-between gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Image src="/icons/pts.svg" alt="Points" width={16} height={16} className="w-4 h-4" />
            <span className="font-semibold text-primary">
              +{formatScore(Number(totalPoints))} PTS
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Image src="/icons/tod.svg" alt="Time of Death" width={16} height={16} className="w-4 h-4" />
            <span className="font-semibold text-primary">
              +{formatLifetimeProduction(totalLifetime)} TOD
            </span>
          </div>
        </div>

        {/* Multi-batch info */}
        {hasMultipleBatches && (
          <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400 text-xs">
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
          <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg space-y-2">
            <div className="flex items-center gap-2 text-primary font-bold text-xs">
              <Lock className="w-3 h-3" />
              Smart Wallet Required
            </div>
          </div>
        ) : !hasEnoughTokens ? (
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg space-y-1">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-bold text-xs">
              <Lock className="w-3 h-3" />
              Insufficient PIXOTCHI Balance
            </div>
            <div className="text-[10px] font-mono text-muted-foreground">
              Required: {BURN_AMOUNT_TOKENS} to burn | Balance: {pixotchiBalanceNum.toFixed(2)}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
             <div className="flex justify-between items-center text-xs px-1">
               <span className="text-muted-foreground">Cost:</span>
               <span className="font-mono text-primary font-semibold">
                 {BURN_AMOUNT_TOKENS} PIXOTCHI
               </span>
             </div>
          <SmartWalletTransaction
            key={txKey} // Force re-mount to reset button state after each batch
            calls={calls}
              buttonText={hasMultipleBatches ? `Burn & Claim Batch (${currentBatchItems.length})` : "Burn & Claim All"}
            buttonClassName="w-full font-bold h-9 text-sm"
            onSuccess={(tx) => {
              const claimedCount = currentBatchItems.length;
              const remainingCount = claimableItems.length - claimedCount;
              const newTotalClaimed = totalClaimedThisSession + claimedCount;
              
              setTotalClaimedThisSession(newTotalClaimed);
              setTxKey(k => k + 1); // Increment key to reset Transaction component
              
              if (remainingCount > 0) {
                  toast.success(`Burned ${BURN_AMOUNT_TOKENS} tokens & Claimed ${claimedCount} buildings! ${remainingCount} remaining.`);
              } else {
                  toast.success(`Burned ${BURN_AMOUNT_TOKENS} tokens & Claimed all ${newTotalClaimed} buildings!`);
              }
              
              scanLands(); // Re-scan to update remaining items
              if (onSuccess) onSuccess();
              window.dispatchEvent(new Event('balances:refresh'));
              window.dispatchEvent(new Event('buildings:refresh'));
              
              // Trigger claim production task for gamification
              try {
                const payload: Record<string, unknown> = { address, taskId: 's1_claim_production' };
                const txHash = extractTransactionHash(tx);
                if (txHash) {
                  payload.proof = { txHash };
                }
                fetch('/api/gamification/missions', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                });
              } catch {}
            }}
            onError={(e) => toast.error("Batch claim failed")}
          />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
