"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ResourceValue } from '@/components/ui/resource-value';
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ResourceState } from "@/components/ui/resource-state";
import { BackgroundRefresh } from "@/components/ui/background-refresh";
import { useBatchReconciliation } from "@/hooks/useBatchReconciliation";
import { useQuestRewardsAvailability } from "@/hooks/useQuestRewardsAvailability";
import { useQuestConfiguration } from '@/hooks/useQuestConfiguration';
import { requireFarmerHouseStartsReady } from '@/lib/farmer-house-start-readiness';
import { QuestDifficultySummary } from '@/components/building-details/quest-difficulty-summary';
import { formatUpgradeDuration } from '@/lib/utils';
import { useBalances } from "@/lib/balance-context";
import {
  CREATOR_TOKEN_ADDRESS,
  QUEST_DIFFICULTIES,
  buildQuestStartCall,
  getQuestSlotsBatch,
  getReadClient,
  isQuestDifficultyId,
  toQuestSlotSnapshots,
  type QuestDifficultyId,
  type QuestSlotSnapshot,
  type QuestSlotState,
} from "@/lib/contracts";
import { postMissionProgress } from "@/lib/mission-tracking";
import {
  DEFAULT_BATCH_QUEST_DIFFICULTY,
  clearBatchQuestRun,
  getBatchQuestRunSubmissionIdentity,
  isBatchQuestRunPending,
  isBatchQuestRunPaid,
  loadBatchQuestDifficulty,
  markBatchQuestRunPending,
  markBatchQuestRunPaid,
  storeBatchQuestDifficulty,
} from "@/lib/quest-preferences";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { extractTransactionHash, getHighestTransactionReceiptBlock } from "@/lib/transaction-utils";
import { Land } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AlertTriangle, Loader2, Lock } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { erc20Abi, parseUnits } from "viem";
import { TokenAmount } from '@/components/ui/token-amount';
import { useAccount } from "wagmi";
import SmartWalletTransaction from "./smart-wallet-transaction";
import type { LifecycleStatus } from "./transaction-kit";

interface BatchQuestStartCardProps {
  lands: Land[];
  onSuccess?: () => void;
  onOpenFarmerHouse?: () => void;
  variant?: "card" | "embedded";
  showWhenEmpty?: boolean;
  className?: string;
}

const BURN_AMOUNT_TOKENS = Number(process.env.NEXT_PUBLIC_BATCH_QUEST_BURN_AMOUNT || 85000);
const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";

/**
 * Maximum questStart calls per bundle.
 *
 * Measured on mainnet: questStart costs 93,855 gas on Easy and 113,925 on Hard
 * (the 20k delta is the one zero-to-nonzero SSTORE for a non-EASY difficulty).
 * The binding constraint is the EIP-7825 per-transaction cap of 16,777,216 gas,
 * adopted by Base in the Azul hardfork and enforced at validation - not the
 * block limit, which is 400M.
 *
 *   budget    = 16,777,216 * 0.75  = 12.58M   (25% held back for bundler
 *                                              overhead and gas variance)
 *   per call  = 113,925 + ~5,000   = ~119k    (worst-case Hard + bundler)
 *   ceiling   = 12.58M / 119k      = ~105 calls
 *
 * 100 is that ceiling rounded down.
 *
 * Chunking IS a live path, not headroom. Batching synchronises a fleet: farmers
 * sent together finish, rest and fall idle together, so a wallet's steady-state
 * batch is its TOTAL slot count, not whatever happens to be idle right now. The
 * two largest wallets hold 119 and 111 slots, so both split into two bundles.
 * The first confirmed bundle pays the run fee; continuation bundles do not.
 *
 * Raising the cap to swallow 119 in one bundle would need ~14.2M gas on Hard
 * (85% of the cap), which is too little margin for a bundler overhead figure we
 * have not measured against a real smart wallet.
 */
const MAX_BATCH_SIZE = Number(process.env.NEXT_PUBLIC_BATCH_QUEST_MAX_SIZE || 100);

const SECONDS_PER_BLOCK = 2;

type BatchQuestSnapshot = QuestSlotSnapshot & { readBlock: bigint };
const questSlotKey = (slot: BatchQuestSnapshot) => `${slot.landId}/${slot.slotIndex}/${slot.state}`;
type SubmittedQuestBatch = {
  slots: BatchQuestSnapshot[];
  difficulty: QuestDifficultyId;
  shouldBurn: boolean;
  scope: string;
};

const embeddedSurfaceClassName =
  "surface-lifted rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-4 shadow-[var(--shadow-hairline)]";

const CENSUS_ROWS: Array<{ state: QuestSlotState; label: string; alwaysShow?: boolean }> = [
  { state: "available", label: "Idle", alwaysShow: true },
  { state: "in_progress", label: "On adventure" },
  { state: "ready_to_commit", label: "Returning" },
  { state: "committed", label: "Loot bags" },
  { state: "expired", label: "Expired — reset required" },
  { state: "cooldown", label: "Resting" },
];

function formatBlocksAsDuration(blocks: bigint): string {
  const seconds = Number(blocks) * SECONDS_PER_BLOCK;
  if (!Number.isFinite(seconds) || seconds <= 0) return "now";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
}

/** Soonest block at which any slot in `states` changes hands, as a duration. */
function soonestHint(
  snapshots: QuestSlotSnapshot[],
  state: QuestSlotState,
  currentBlock: bigint,
): string | null {
  const targets = snapshots.filter((snapshot) => snapshot.state === state);
  if (targets.length === 0 || currentBlock === BigInt(0)) return null;

  const targetBlock = targets.reduce((soonest, snapshot) => {
    const block = state === "cooldown" ? snapshot.coolDownBlock : snapshot.endBlock;
    return soonest === null || block < soonest ? block : soonest;
  }, null as bigint | null);

  if (targetBlock === null || targetBlock <= currentBlock) return "ready";
  return `~${formatBlocksAsDuration(targetBlock - currentBlock)}`;
}

function getSubmittedIdentity(value: UntypedValue): string | undefined {
  const hash = extractTransactionHash(value);
  if (hash) return hash.toLowerCase();

  const candidate = value?.transactionId ?? value?.id;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function matchesSubmittedIdentity(value: UntypedValue, expected: string): boolean {
  const hash = extractTransactionHash(value);
  if (typeof hash === "string" && hash.toLowerCase() === expected) return true;

  // A batched EIP-5792 submission is initially recorded under its calls ID,
  // then may later report both that ID and the canonical transaction hash.
  // Check every documented identity rather than letting the later hash hide
  // the saved calls ID.
  return value?.transactionId === expected || value?.id === expected;
}

export default function BatchQuestStartCard({
  lands,
  onSuccess,
  onOpenFarmerHouse,
  variant = "card",
  showWhenEmpty = false,
  className,
}: BatchQuestStartCardProps) {
  // The flat fee is charged once per run, not once per bundle. A fleet larger
  // than MAX_BATCH_SIZE still costs BURN_AMOUNT_TOKENS in total.
  const [runPaid, setRunPaid] = useState(false);
  const [feePending, setFeePending] = useState(false);
  const [totalSentThisSession, setTotalSentThisSession] = useState(0);
  const [submittedBatch, setSubmittedBatch] = useState<SubmittedQuestBatch | null>(null);
  const submittedBatchRef = useRef<SubmittedQuestBatch | null>(null);
  const retiredProofRef = useRef<string | undefined>(undefined);
  const [difficulty, setDifficulty] = useState<QuestDifficultyId>(DEFAULT_BATCH_QUEST_DIFFICULTY);

  const { isLoading: smartWalletLoading, isSmartWallet } = useSmartWallet();
  const { pixotchiBalance, pixotchiBalanceStatus } = useBalances();
  const { address } = useAccount();
  const rewards = useQuestRewardsAvailability();
  const questConfiguration = useQuestConfiguration();

  useEffect(() => {
    setDifficulty(loadBatchQuestDifficulty());
  }, []);

  const burnAmountWei = useMemo(() => parseUnits(BURN_AMOUNT_TOKENS.toString(), 18), []);
  const shouldBurn = submittedBatch?.shouldBurn ?? !runPaid;
  const hasEnoughTokens = !shouldBurn
    || (pixotchiBalanceStatus === "ready" && pixotchiBalance >= burnAmountWei);

  const landIdsHash = useMemo(
    () => lands.map((land) => land.tokenId.toString()).sort().join(","),
    [lands],
  );
  const batchRunScope = useMemo(
    () => `${address?.toLowerCase() ?? "disconnected"}:${landIdsHash}`,
    [address, landIdsHash],
  );
  const feeSubmissionIdentityRef = useRef<string | null>(null);
  const currentBatchRunScopeRef = useRef(batchRunScope);
  currentBatchRunScopeRef.current = batchRunScope;

  // Re-read on every land-set change so a different wallet or holdings starts a
  // fresh, unpaid run.
  useEffect(() => {
    feeSubmissionIdentityRef.current = getBatchQuestRunSubmissionIdentity(batchRunScope) ?? null;
    setRunPaid(isBatchQuestRunPaid(batchRunScope));
    setFeePending(isBatchQuestRunPending(batchRunScope));
  }, [batchRunScope]);

  const readQuests = useCallback(async (minimumBlock?: bigint) => {
      const landIds = landIdsHash ? landIdsHash.split(',').map(BigInt) : [];
      if (landIds.length === 0) return [];
      const readClient = getReadClient();
      const currentBlock = await readClient.getBlockNumber({ cacheTime: 0 });
      if (minimumBlock !== undefined && currentBlock < minimumBlock) throw new Error('Quest node is behind the receipt.');
      const batch = await getQuestSlotsBatch(landIds, { readClient, blockNumber: currentBlock });
      if (batch.some((entry) => !entry.ok)) throw new Error('Some farmer slots could not be read.');
      return toQuestSlotSnapshots(batch, currentBlock).map((slot) => ({ ...slot, readBlock: currentBlock }));
  }, [landIdsHash]);

  const { items: snapshots, loading, ready: scanReady, error: scanError, coordinator, refresh: scanQuests } = useBatchReconciliation({
    identity: batchRunScope,
    address,
    read: readQuests,
    key: questSlotKey,
    errorMessage: 'Farmer slots could not all be checked. Retry before sending another batch.',
  });
  const scanBlock = snapshots[0]?.readBlock ?? BigInt(0);

  useEffect(() => {
    setTotalSentThisSession(0);
    setSubmittedBatch(null);
    submittedBatchRef.current = null;
    retiredProofRef.current = undefined;
  }, [batchRunScope]);

  const counts = useMemo(() => {
    const tally: Record<QuestSlotState, number> = {
      available: 0,
      committed: 0,
      expired: 0,
      cooldown: 0,
      in_progress: 0,
      ready_to_commit: 0,
    };
    for (const snapshot of snapshots) tally[snapshot.state] += 1;
    return tally;
  }, [snapshots]);

  const idleSlots = useMemo(
    () => snapshots.filter((snapshot) => snapshot.state === "available"),
    [snapshots],
  );

  // A run ends once no idle farmers remain, so the next cycle pays again.
  // Guarded on a non-empty snapshot set because a wholly failed scan also
  // reports zero idle, and closing the run on that would charge the fee twice
  // for a single run.
  useEffect(() => {
    if (!scanReady || submittedBatch || !runPaid || snapshots.length === 0 || idleSlots.length > 0) return;
    clearBatchQuestRun();
    setRunPaid(false);
  }, [idleSlots.length, runPaid, scanReady, snapshots.length, submittedBatch]);

  const totalBatches = Math.ceil(idleSlots.length / MAX_BATCH_SIZE);
  const hasMultipleBatches = idleSlots.length > MAX_BATCH_SIZE;
  const currentBatchSlots = useMemo(
    () => submittedBatch?.slots ?? idleSlots.slice(0, MAX_BATCH_SIZE),
    [idleSlots, submittedBatch],
  );

  const calls = useMemo(() => {
    if (currentBatchSlots.length === 0) return [];

    const startCalls = currentBatchSlots.map((slot) =>
      buildQuestStartCall(slot.landId, submittedBatch?.difficulty ?? difficulty, slot.slotIndex),
    );

    // Continuation bundles of an already-paid run carry no burn.
    if (!shouldBurn) return startCalls;

    const burnCall = {
      abi: erc20Abi,
      address: CREATOR_TOKEN_ADDRESS,
      args: [BURN_ADDRESS as `0x${string}`, burnAmountWei],
      functionName: "transfer",
    };

    return [burnCall, ...startCalls];
  }, [burnAmountWei, currentBatchSlots, difficulty, shouldBurn, submittedBatch]);

  const batchQuestIntentKey = useMemo(() => {
    const pairs = [...currentBatchSlots]
      .sort((a, b) => {
        if (a.landId < b.landId) return -1;
        if (a.landId > b.landId) return 1;
        return a.slotIndex - b.slotIndex;
      })
      .map((slot) => `${slot.landId}/${slot.slotIndex}`)
      .join(",");
    return `batch-quest-start:${submittedBatch?.difficulty ?? difficulty}:${shouldBurn ? "burn" : "paid"}:${pairs}`;
  }, [currentBatchSlots, difficulty, shouldBurn, submittedBatch]);

  const handleDifficultyChange = useCallback((nextValue: string | number) => {
    if (submittedBatch) return;
    const parsed = Number(nextValue);
    if (!isQuestDifficultyId(parsed)) return;
    setDifficulty(parsed);
    storeBatchQuestDifficulty(parsed);
  }, [submittedBatch]);

  const handleBatchStatus = useCallback((status: LifecycleStatus) => {
    if (status.statusName === 'confirmedSyncing' && status.statusData.callsMatch !== false) {
      const proof = extractTransactionHash(status.statusData) ?? status.statusData.transactionId;
      if (proof && retiredProofRef.current !== proof) {
        retiredProofRef.current = proof;
        const confirmedBatch = submittedBatchRef.current ?? { slots: currentBatchSlots, difficulty, shouldBurn, scope: batchRunScope };
        submittedBatchRef.current = confirmedBatch;
        setSubmittedBatch(confirmedBatch);
        coordinator.retire(confirmedBatch.slots,
          getHighestTransactionReceiptBlock(status.statusData.transactionReceipts));
      }
    }
    if (['idle', 'success', 'reverted', 'error', 'failed', 'cancelled', 'canceled', 'rejected', 'transactionRejected', 'userRejected', 'buildError'].includes(status.statusName)) {
      setSubmittedBatch(null);
    }
    const identity = getSubmittedIdentity(status.statusData);
    if (
      shouldBurn
      && identity
      && (status.statusName === "transactionPending" || status.statusName === "transactionUnresolved")
    ) {
      // Persist the submitted identity for recovery, but do not waive the fee
      // for another bundle until transaction-kit has a canonical success
      // receipt. A dropped operation must never create a free continuation.
      feeSubmissionIdentityRef.current = identity;
      markBatchQuestRunPending(batchRunScope, Date.now(), identity);
      setFeePending(true);
      return;
    }

    if (
      status.statusName === "reverted"
      && feeSubmissionIdentityRef.current !== null
      && matchesSubmittedIdentity(status.statusData, feeSubmissionIdentityRef.current)
    ) {
      // A submitted but reverted fee must remain retryable, including after a
      // remount restored its durable submission identity. Do not let an old
      // callback revoke a newer run's marker.
      clearBatchQuestRun();
      feeSubmissionIdentityRef.current = null;
      setFeePending(false);
      setRunPaid(false);
    }
  }, [batchRunScope, shouldBurn, coordinator, currentBatchSlots, difficulty]);

  const handleBatchSuccess = useCallback((tx: UntypedValue) => {
    const submitted = submittedBatchRef.current;
    if (submitted && submitted.scope !== batchRunScope) return;
    const sentCount = submitted?.slots.length ?? currentBatchSlots.length;
    const remainingCount = coordinator.state.items.filter((slot) => slot.state === 'available').length;
    const newTotalSent = totalSentThisSession + sentCount;

    setTotalSentThisSession(newTotalSent);

    if (shouldBurn) {
      const identity = getSubmittedIdentity(tx) ?? feeSubmissionIdentityRef.current ?? undefined;
      markBatchQuestRunPaid(batchRunScope, Date.now(), identity);
      feeSubmissionIdentityRef.current = identity ?? null;
      setFeePending(false);
      setRunPaid(true);
    }

    const feeNote = shouldBurn
      ? `Burned ${BURN_AMOUNT_TOKENS.toLocaleString()} PIXOTCHI & sent`
      : "Sent";

    if (remainingCount > 0) {
      toast.success(`${feeNote} ${sentCount} farmers! ${remainingCount} left - no extra fee.`);
    } else {
      toast.success(`${feeNote} all ${newTotalSent} farmers!`);
    }

    onSuccess?.();

    try {
      const payload: Record<string, UntypedValue> = { address, taskId: "s3_send_quest" };
      const txHash = extractTransactionHash(tx);
      if (txHash) payload.proof = { txHash };
      postMissionProgress(payload);
    } catch {
      // Mission tracking is best-effort and must never block the send.
    }
  }, [address, batchRunScope, coordinator, currentBatchSlots.length, onSuccess, shouldBurn, totalSentThisSession]);

  if (!submittedBatch && !feePending && !scanError && !scanReady && snapshots.length === 0) {
    const loadingContent = (
      <div className="flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Scanning farmer slots...</span>
      </div>
    );

    if (variant === "embedded") {
      return <div className={cn(embeddedSurfaceClassName, "py-6", className)}>{loadingContent}</div>;
    }

    return (
      <Card className={cn("border-dashed", className)}>
        <CardContent className="py-6">{loadingContent}</CardContent>
      </Card>
    );
  }

  if (scanError && !submittedBatch && !feePending) return <ResourceState status="error" title="Farmer slots unavailable" description={scanError} onRetry={() => void scanQuests()} className={className} />;

  const hasAnySlots = snapshots.length > 0 || submittedBatch !== null || feePending;

  if (!hasAnySlots && !showWhenEmpty) return null;

  const censusRows = CENSUS_ROWS.filter((row) => row.alwaysShow || counts[row.state] > 0);

  const content = (
    <>
      {!rewards.isReady && <ResourceState status={rewards.error ? 'error' : 'loading'}
        title={rewards.error ? 'Quest rewards check unavailable' : 'Checking quest rewards…'}
        description={rewards.error ? 'Retry before starting quests. Existing loot bags can still be checked and opened in Farmer House.' : undefined}
        onRetry={() => { void rewards.refresh(); }} />}
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <span className="flex items-center gap-2 font-semibold">Batch Quests<BackgroundRefresh active={loading} label="Updating farmers before the next batch" /></span>
        <div className="flex items-center gap-2 text-xs">
          {totalSentThisSession > 0 && (
            <span className="font-medium text-[hsl(var(--success-strong))]">
              ✓ {totalSentThisSession} sent
            </span>
          )}
          <span className="text-muted-foreground">
            {hasAnySlots
              ? `${lands.length} land${lands.length === 1 ? "" : "s"} • ${snapshots.length} slot${snapshots.length === 1 ? "" : "s"}`
              : "No Farmer House"}
          </span>
        </div>
      </div>

      {!hasAnySlots ? (
        <div className="space-y-3">
          <div className="rounded-[var(--radius-control)] border border-border/45 bg-background/45 p-3 text-sm text-muted-foreground">
            None of your lands have a Farmer House yet. Upgrade one to unlock farmer
            slots and send them on quests.
          </div>
          {onOpenFarmerHouse && <Button variant="outline" className="w-full" onClick={onOpenFarmerHouse}>View Farmer House</Button>}
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {censusRows.map((row) => {
              const hint =
                row.state === "in_progress" || row.state === "cooldown"
                  ? soonestHint(snapshots, row.state, scanBlock)
                  : null;

              return (
                <div key={row.state} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="flex items-center gap-2">
                    {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        row.state === "available" && counts[row.state] > 0 && "text-primary",
                      )}
                    >
                      {counts[row.state]}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>

          {scanError && <ResourceState status="error" title="Farmer refresh delayed" description={scanError} onRetry={() => void scanQuests()} />}

          {(counts.ready_to_commit > 0 || counts.committed > 0 || counts.expired > 0) && (
            <div className="rounded-[var(--radius-control)] border border-border/45 bg-background/45 p-2 text-xs text-muted-foreground">
              Return farmers, open loot bags, and reset expired quests individually
              in each land&apos;s Farmer House.
            </div>
          )}

          {idleSlots.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Difficulty</span>
              <span className="text-xs text-muted-foreground">Applies to all</span>
            </div>
            <ToggleGroup
              ariaLabel="Quest difficulty for this batch"
              className="w-full"
              getButtonClassName={(value, selected) => {
                const base = "min-w-0 flex-1 px-2";
                if (value === "0") {
                  return cn(
                    base,
                    selected
                      ? "bg-[hsl(var(--success)/0.18)] text-[hsl(var(--success-strong))]"
                      : "text-[hsl(var(--success-strong))]",
                  );
                }
                if (value === "1") {
                  return cn(
                    base,
                    selected
                      ? "bg-[hsl(var(--warning)/0.18)] text-[hsl(var(--warning))]"
                      : "text-[hsl(var(--warning))]",
                  );
                }
                return cn(
                  base,
                  selected ? "bg-destructive/15 text-destructive" : "text-destructive",
                );
              }}
              onValueChange={handleDifficultyChange}
              options={QUEST_DIFFICULTIES.map((entry) => ({
                ariaLabel: `${entry.label} quest`,
                label: (
                  <span>
                    {entry.label}{" "}
                    <span className="text-xs text-muted-foreground">({questConfiguration.isReady && questConfiguration.data ? formatUpgradeDuration(questConfiguration.data.difficulties[entry.id].durationInBlocks) : '—'})</span>
                  </span>
                ),
                value: String(entry.id),
              }))}
              value={String(difficulty)}
            />
            <QuestDifficultySummary value={difficulty} />
          </div>
          )}

          {hasMultipleBatches && (
            <div className="rounded-[var(--radius-control)] border border-[hsl(var(--info)/0.22)] bg-[hsl(var(--info)/0.1)] p-2">
              <div className="flex items-center gap-2 text-xs text-info-strong">
                <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                <span>
                  Large send split into {totalBatches} transactions of {MAX_BATCH_SIZE}.
                  This one: {currentBatchSlots.length} farmers. The{" "}
                  {BURN_AMOUNT_TOKENS.toLocaleString()} PIXOTCHI fee is charged once for
                  the whole run, not per transaction.
                </span>
              </div>
            </div>
          )}

          {!submittedBatch && !feePending && !smartWalletLoading && !isSmartWallet && (
            <div className="space-y-2 rounded-[var(--radius-control)] border border-primary/20 bg-primary/10 p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-primary">
                <Lock className="h-3 w-3" />
                Smart Wallet Required
              </div>
              <p className="text-sm text-muted-foreground">You can send farmers individually with your current wallet. A smart wallet sends up to {MAX_BATCH_SIZE} farmers per transaction.</p>
              {onOpenFarmerHouse && <Button variant="outline" className="w-full" onClick={onOpenFarmerHouse}>Manage farmers individually</Button>}
            </div>
          )}

          {!submittedBatch && !feePending && idleSlots.length === 0 ? (
            <div className="rounded-[var(--radius-control)] border border-border/45 bg-background/45 p-3 text-sm text-muted-foreground">
              No idle farmers right now. Finish active quests in Farmer House by returning
              each farmer and opening its loot bag, or reset expired quests. Farmers become
              available again after any cooldown ends.
            </div>
          ) : !submittedBatch && !feePending && rewards.isUnavailable ? (
            <ResourceState status="empty" title="Quest rewards temporarily unavailable"
              description="Starting new quests is paused. Refresh availability before trying again."
              onRetry={() => { void rewards.refresh(); }} />
          ) : !submittedBatch && !feePending && !smartWalletLoading && !isSmartWallet ? (
            null
          ) : !submittedBatch && !feePending && shouldBurn && pixotchiBalanceStatus !== "ready" ? (
            <div className="space-y-1 rounded-[var(--radius-control)] border border-amber-500/20 bg-amber-500/10 p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-value">
                <AlertTriangle className="h-3 w-3" />
                Balance unavailable
              </div>
              <div className="text-[10px] text-muted-foreground">
                PIXOTCHI balance could not be confirmed. Refresh before paying the run fee.
              </div>
            </div>
          ) : !submittedBatch && !feePending && !hasEnoughTokens ? (
            <div className="space-y-1 rounded-[var(--radius-control)] border border-amber-500/20 bg-amber-500/10 p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-value">
                <Lock className="h-3 w-3" />
                Insufficient PIXOTCHI Balance
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">
                Required: {BURN_AMOUNT_TOKENS.toLocaleString()} to burn | Balance:{" "}
                <TokenAmount amount={pixotchiBalance} unit="PIXOTCHI" />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1 text-xs">
                <span className="text-muted-foreground">Cost:</span>
                {shouldBurn ? (
                  <ResourceValue resource="pixotchi" className="font-mono font-semibold text-primary">
                    {BURN_AMOUNT_TOKENS.toLocaleString()} PIXOTCHI
                  </ResourceValue>
                ) : (
                  <span className="font-semibold text-[hsl(var(--success-strong))]">
                    Already paid this run
                  </span>
                )}
              </div>
              <SmartWalletTransaction
                successFeedback="feature"
                effects={{ domains: ["buildings", "lands", "balances"] }}
                intentKey={batchQuestIntentKey}
                calls={calls}
                buttonText={
                  feePending ? "Confirming fee…" : hasMultipleBatches
                    ? `${shouldBurn ? "Burn & " : ""}Send Batch (${currentBatchSlots.length})`
                    : `${shouldBurn ? "Burn & " : ""}Send ${currentBatchSlots.length} Farmer${currentBatchSlots.length === 1 ? "" : "s"}`
                }
                buttonClassName="h-11 min-h-11 w-full text-sm font-bold"
                disabled={!scanReady || feePending || !rewards.isReady || !questConfiguration.isReady || smartWalletLoading || !isSmartWallet || !hasEnoughTokens}
                onButtonClick={async () => {
                  coordinator.assertReady(currentBatchSlots);
                  if (!questConfiguration.isReady || !questConfiguration.data) throw new Error('Check the quest terms before starting.');
                  await rewards.requireReady(questConfiguration.data);
                  // Pause the complete reviewed batch. Do not skip slots or
                  // close its paid run while a Farmer House is constructing.
                  await requireFarmerHouseStartsReady(currentBatchSlots.map(slot => slot.landId),
                    () => currentBatchRunScopeRef.current === batchRunScope);
                  coordinator.assertReady(currentBatchSlots);
                  const submitted = { slots: currentBatchSlots, difficulty, shouldBurn, scope: batchRunScope };
                  submittedBatchRef.current = submitted;
                  setSubmittedBatch(submitted);
                }}
                onStatusUpdate={handleBatchStatus}
                onSuccess={handleBatchSuccess}
              />
            </div>
          )}
        </>
      )}
    </>
  );

  if (variant === "embedded") {
    return <div className={cn(embeddedSurfaceClassName, "space-y-3", className)}>{content}</div>;
  }

  return (
    <Card className={cn("border-primary/20", className)}>
      <CardContent className="space-y-3">{content}</CardContent>
    </Card>
  );
}
