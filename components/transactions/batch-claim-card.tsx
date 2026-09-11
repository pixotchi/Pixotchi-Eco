"use client";

import { Card,CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ResourceState } from "@/components/ui/resource-state";
import { BackgroundRefresh } from "@/components/ui/background-refresh";
import { useBatchReconciliation } from '@/hooks/useBatchReconciliation';
import { useBalances } from '@/lib/balance-context';
import { getLandBuildingsBatch,getReadClient,LAND_CONTRACT_ADDRESS } from '@/lib/contracts';
import { postMissionProgress } from '@/lib/mission-tracking';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { extractTransactionHash,getHighestTransactionReceiptBlock } from '@/lib/transaction-utils';
import { Land } from '@/lib/types';
import { cn,formatLifetimeProduction,formatScore } from '@/lib/utils';
import { landAbi } from '@/public/abi/pixotchi-v3-abi';
import { AlertTriangle,Loader2,Lock } from 'lucide-react';
import Image from 'next/image';
import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { toast } from 'react-hot-toast';
import { erc20Abi,parseUnits } from 'viem';
import { TokenAmount } from '@/components/ui/token-amount';
import { ResourceValue } from '@/components/ui/resource-value';
import { useAccount } from 'wagmi';
import SmartWalletTransaction from './smart-wallet-transaction';
import type { LifecycleStatus } from './transaction-kit';

interface BatchClaimCardProps {
  lands: Land[];
  onSuccess?: () => void;
  onOpenBuildings?: () => void;
  variant?: 'card' | 'embedded';
  showWhenEmpty?: boolean;
  className?: string;
}

interface ClaimableItem {
  landId: bigint;
  buildingId: number;
  points: bigint;
  lifetime: bigint;
}

const claimKey = (item: ClaimableItem) => `${item.landId}/${item.buildingId}`;

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

const embeddedSurfaceClassName = "surface-lifted rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-4 shadow-[var(--shadow-hairline)]";

export default function BatchClaimCard({
  lands,
  onSuccess,
  onOpenBuildings,
  variant = 'card',
  showWhenEmpty = false,
  className
}: BatchClaimCardProps) {
  // Track total claimed across batches for progress display
  const [totalClaimedThisSession, setTotalClaimedThisSession] = useState(0);
  const [submittedItems, setSubmittedItems] = useState<ClaimableItem[] | null>(null);
  const submittedItemsRef = useRef<ClaimableItem[]>([]);
  const retiredProofRef = useRef<string | undefined>(undefined);
  const { isSmartWallet } = useSmartWallet();
  const {
    pixotchiBalance,
    pixotchiBalanceStatus,
    balanceError,
    refreshBalances,
  } = useBalances();
  const { address } = useAccount();

  const pixotchiBalanceKnown = pixotchiBalanceStatus === 'ready';
  const burnAmountWei = parseUnits(BURN_AMOUNT_TOKENS.toString(), 18);
  const hasEnoughTokens = pixotchiBalanceKnown && pixotchiBalance >= burnAmountWei;
  const retryBalance = () => { void refreshBalances(); };
  const balanceErrorMessage = balanceError instanceof Error
    ? balanceError.message
    : typeof balanceError === 'string' ? balanceError : null;

  // Memoize land IDs to detect changes
  const landIdsHash = useMemo(() =>
    lands.map(l => l.tokenId.toString()).sort().join(','),
    [lands]
  );

  const scanIdentity = (address?.toLowerCase() ?? '') + ':' + landIdsHash;
  const readProduction = useCallback(async (minimumBlock?: bigint) => {
      const landIds = landIdsHash ? landIdsHash.split(',').map(BigInt) : [];
      if (landIds.length === 0) return [];
      const readClient = getReadClient();
      const currentBlock = await readClient.getBlockNumber({ cacheTime: 0 });
      if (minimumBlock !== undefined && currentBlock < minimumBlock) throw new Error('Production node is behind the receipt.');
      const results = await getLandBuildingsBatch(landIds, { requireComplete: true, readClient, blockNumber: currentBlock });
      const items: ClaimableItem[] = [];

      results.forEach(result => {
        // Check village buildings (0: Solar, 3: Soil, 5: Bee)
        // Note: building IDs in result are from contract, so we iterate what we got
        result.villageBuildings.forEach((b: UntypedValue) => {
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

      return items;
  }, [landIdsHash]);

  const { items: claimableItems, loading, error: scanError, ready: scanReady, coordinator, refresh: scanLands } = useBatchReconciliation({
    identity: scanIdentity,
    address,
    read: readProduction,
    key: claimKey,
    errorMessage: 'Production could not be checked. Retry before collecting another batch.',
  });

  useEffect(() => {
    setTotalClaimedThisSession(0);
    setSubmittedItems(null);
    submittedItemsRef.current = [];
    retiredProofRef.current = undefined;
  }, [scanIdentity]);

  // Calculate batch info
  const totalBatches = Math.ceil(claimableItems.length / MAX_BATCH_SIZE);
  const hasMultipleBatches = claimableItems.length > MAX_BATCH_SIZE;

  // Current batch is always the first MAX_BATCH_SIZE items
  // After each successful claim, we re-scan and the claimed items are removed
  const currentBatchItems = useMemo(() =>
    submittedItems ?? claimableItems.slice(0, MAX_BATCH_SIZE),
    [claimableItems, submittedItems]
  );

  // Reward estimates describe the exact subset included in this transaction.
  const batchLifetime = useMemo(() =>
    currentBatchItems.reduce((acc, item) => acc + item.lifetime, BigInt(0)),
    [currentBatchItems]
  );

  // Current batch points/lifetime (what will be claimed this tx)
  const batchPoints = useMemo(() =>
    currentBatchItems.reduce((acc, item) => acc + item.points, BigInt(0)),
    [currentBatchItems]
  );

  // Only create calls for current batch
  const calls = useMemo(() => {
    if (currentBatchItems.length === 0) return [];
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

  const batchClaimIntentKey = useMemo(() => {
    const pairs = [...currentBatchItems]
      .sort((a, b) => {
        if (a.landId < b.landId) return -1;
        if (a.landId > b.landId) return 1;
        return a.buildingId - b.buildingId;
      })
      .map((item) => `${item.landId}/${item.buildingId}`)
      .join(",");
    return `batch-claim:${pairs}`;
  }, [currentBatchItems]);

  const handleBatchStatus = useCallback((status: LifecycleStatus) => {
    if (status.statusName === 'confirmedSyncing' && status.statusData.callsMatch !== false) {
      const proof = extractTransactionHash(status.statusData) ?? status.statusData.transactionId;
      if (proof && retiredProofRef.current !== proof) {
        retiredProofRef.current = proof;
        const confirmedItems = submittedItemsRef.current.length ? submittedItemsRef.current : currentBatchItems;
        submittedItemsRef.current = confirmedItems;
        setSubmittedItems(confirmedItems);
        coordinator.retire(confirmedItems,
          getHighestTransactionReceiptBlock(status.statusData.transactionReceipts));
      }
    }
    if (['idle', 'success', 'reverted', 'error', 'failed', 'cancelled', 'canceled', 'rejected', 'transactionRejected', 'userRejected', 'buildError'].includes(status.statusName)) {
      setSubmittedItems(null);
    }
  }, [coordinator, currentBatchItems]);

  if (!submittedItems && !scanError && !scanReady && claimableItems.length === 0) {
    const loadingContent = (
      <div className="flex justify-center items-center text-muted-foreground gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Scanning accumulated production...</span>
      </div>
    );

    if (variant === 'embedded') {
      return (
        <div className={cn(embeddedSurfaceClassName, "py-6", className)}>
          {loadingContent}
        </div>
      );
    }

    return (
      <Card className={cn("border-dashed", className)}>
        <CardContent className="py-6">
          {loadingContent}
        </CardContent>
      </Card>
    );
  }

  if (scanError && !submittedItems) return <ResourceState status="error" title="Production unavailable" description={scanError} onRetry={() => void scanLands()} className={className} />;

  // Hide if nothing to claim
  if (claimableItems.length === 0 && !submittedItems) {
    if (showWhenEmpty) {
      const emptyContent = (
        <>
          <div className="flex justify-between items-center pb-2 border-b border-border/50">
            <span className="font-semibold">Batch Claim</span>
            <span className="text-xs text-muted-foreground">Nothing ready</span>
          </div>
          <div className="rounded-[var(--radius-control)] border border-border/45 bg-background/45 p-3 text-sm text-muted-foreground">
            No buildings meet the batch minimum yet: 0.1 PTS or 15 seconds of plant lifetime.
            Smaller amounts can still be collected from each village building.
          </div>
          {onOpenBuildings && <Button variant="outline" onClick={onOpenBuildings}>View village production</Button>}
        </>
      );

      if (variant === 'embedded') {
        return (
          <div className={cn(embeddedSurfaceClassName, "space-y-3", className)}>
            {emptyContent}
          </div>
        );
      }

      return (
        <Card className={cn("border-primary/20", className)}>
          <CardContent className="space-y-3">
            {emptyContent}
          </CardContent>
        </Card>
      );
    }

    return null;
  }

  const content = (
    <>
        <div className="flex justify-between items-center pb-2 border-b border-border/50">
          <span className="flex items-center gap-2 font-semibold">Batch Claim<BackgroundRefresh active={loading} label="Updating production before the next batch" /></span>
          <div className="flex items-center gap-2 text-xs">
            {totalClaimedThisSession > 0 && (
              <span className="text-[hsl(var(--success-strong))] font-medium">
                ✓ {totalClaimedThisSession} claimed
              </span>
            )}
            <span className="text-muted-foreground">
              {claimableItems.length} {claimableItems.length === 1 ? 'building' : 'buildings'} remaining
            </span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">This batch: {currentBatchItems.length} {currentBatchItems.length === 1 ? 'building' : 'buildings'}</p>
        <div className="flex items-center justify-between gap-4 text-sm">
          {batchPoints > BigInt(0) && <div className="flex items-center gap-2">
            <Image src="/icons/pts.svg" alt="Points" width={16} height={16} className="w-4 h-4" />
            <span className="font-semibold text-primary">
              +{formatScore(Number(batchPoints))} PTS
            </span>
          </div>}
          {batchLifetime > BigInt(0) && <div className="flex items-center gap-2">
            <Image src="/icons/tod.svg" alt="Lifetime" width={16} height={16} className="w-4 h-4" />
            <span className="font-semibold text-primary">
              +{formatLifetimeProduction(batchLifetime)} lifetime
            </span>
          </div>}
        </div>

        {/* Multi-batch info */}
        {hasMultipleBatches && (
          <div className="rounded-[var(--radius-control)] border border-[hsl(var(--info)/0.22)] bg-[hsl(var(--info)/0.1)] p-2">
            <div className="flex items-center gap-2 text-info-strong text-xs">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              <span>
                Large claim split into {totalBatches} batches of up to {MAX_BATCH_SIZE} buildings.
                This batch: {currentBatchItems.length} buildings ({formatScore(Number(batchPoints))} PTS)
              </span>
            </div>
          </div>
        )}

        {/* Gating Logic */}
        {!submittedItems && !isSmartWallet ? (
          <div className="space-y-2 rounded-[var(--radius-control)] border border-primary/20 bg-primary/10 p-3">
            <div className="flex items-center gap-2 text-primary font-bold text-xs">
              <Lock className="w-3 h-3" />
              Smart Wallet Required
            </div>
            <p className="text-sm text-muted-foreground">You can collect from each village building with your current wallet. Batch collection combines those actions in a smart wallet.</p>
            {onOpenBuildings && <Button variant="outline" onClick={onOpenBuildings}>Collect from a building</Button>}
          </div>
        ) : !submittedItems && !pixotchiBalanceKnown ? (
          <div className="space-y-2 rounded-[var(--radius-control)] border border-amber-500/20 bg-amber-500/10 p-3">
            <div className="flex items-center gap-2 text-value font-bold text-xs">
              <Lock className="w-3 h-3" />
              {pixotchiBalanceStatus === 'unknown' ? 'Checking PIXOTCHI Balance' : 'PIXOTCHI balance unavailable'}
            </div>
            {pixotchiBalanceStatus === 'error' && (
              <>
                <div className="text-[10px] text-muted-foreground" role="status">
                  {balanceErrorMessage || 'Unable to verify the PIXOTCHI balance. Retry before burning tokens.'}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={retryBalance}>
                  Retry balance check
                </Button>
              </>
            )}
          </div>
        ) : !submittedItems && !hasEnoughTokens ? (
          <div className="space-y-1 rounded-[var(--radius-control)] border border-amber-500/20 bg-amber-500/10 p-3">
            <div className="flex items-center gap-2 text-value font-bold text-xs">
              <Lock className="w-3 h-3" />
              Insufficient PIXOTCHI Balance
            </div>
            <div className="text-[10px] font-mono text-muted-foreground">
              Required: {BURN_AMOUNT_TOKENS} to burn | Balance: <TokenAmount amount={pixotchiBalance} unit="PIXOTCHI" />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs px-1">
              <span className="text-muted-foreground">This batch cost:</span>
              <ResourceValue resource="pixotchi" className="font-mono text-primary font-semibold">
                {BURN_AMOUNT_TOKENS} PIXOTCHI
              </ResourceValue>
            </div>
            {hasMultipleBatches && <p className="px-1 text-xs text-muted-foreground">Remaining total cost: {(totalBatches * BURN_AMOUNT_TOKENS).toLocaleString()} PIXOTCHI across {totalBatches} batches.</p>}
            {scanError && <ResourceState status="error" title="Production refresh delayed" description={scanError} onRetry={() => void scanLands()} />}
            <SmartWalletTransaction
              successFeedback="feature"
              effects={{ domains: ["buildings", "lands", "balances", "rewards"] }}
              intentKey={batchClaimIntentKey}
              calls={calls}
              buttonText={hasMultipleBatches ? `Burn & Claim Batch (${currentBatchItems.length})` : "Burn & Claim All"}
              buttonClassName="h-11 min-h-11 w-full text-sm font-bold"
              disabled={!scanReady || !isSmartWallet || !hasEnoughTokens}
              onButtonClick={() => {
                coordinator.assertReady(currentBatchItems);
                submittedItemsRef.current = currentBatchItems;
                setSubmittedItems(currentBatchItems);
              }}
              onStatusUpdate={handleBatchStatus}
              onSuccess={(tx) => {
                const claimedCount = submittedItemsRef.current.length || currentBatchItems.length;
                const remainingCount = coordinator.state.items.length;
                const newTotalClaimed = totalClaimedThisSession + claimedCount;

                setTotalClaimedThisSession(newTotalClaimed);

                if (remainingCount > 0) {
                  toast.success(`Burned ${BURN_AMOUNT_TOKENS} PIXOTCHI and collected production from ${claimedCount} ${claimedCount === 1 ? 'building' : 'buildings'}. ${remainingCount} remaining.`);
                } else {
                  toast.success(`Burned ${BURN_AMOUNT_TOKENS} PIXOTCHI and collected production from ${claimedCount} ${claimedCount === 1 ? 'building' : 'buildings'}. All batches complete.`);
                }

                if (onSuccess) onSuccess();

                // Trigger claim production task for gamification
                try {
                  const payload: Record<string, UntypedValue> = { address, taskId: 's3_claim_production' };
                  const txHash = extractTransactionHash(tx);
                  if (txHash) {
                    payload.proof = { txHash };
                  }
                  postMissionProgress(payload);
                } catch { }
              }}
            />
          </div>
        )}
    </>
  );

  if (variant === 'embedded') {
    return (
      <div className={cn(embeddedSurfaceClassName, "space-y-3", className)}>
        {content}
      </div>
    );
  }

  return (
    <Card className={cn("border-primary/20", className)}>
      <CardContent className="space-y-3">
        {content}
      </CardContent>
    </Card>
  );
}
