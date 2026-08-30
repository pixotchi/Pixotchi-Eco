"use client";

import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { useQuestRewardsAvailability } from "@/hooks/useQuestRewardsAvailability";
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
  isBatchQuestRunPaid,
  loadBatchQuestDifficulty,
  markBatchQuestRunPaid,
  storeBatchQuestDifficulty,
} from "@/lib/quest-preferences";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { dispatchPostTransactionRefresh } from "@/lib/transaction-refresh";
import { extractTransactionHash } from "@/lib/transaction-utils";
import { Land } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AlertTriangle, Loader2, Lock } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { useAccount } from "wagmi";
import SmartWalletTransaction from "./smart-wallet-transaction";

interface BatchQuestStartCardProps {
  lands: Land[];
  onSuccess?: () => void;
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
 * two largest wallets hold 119 and 111 slots, so both split into two bundles -
 * and because the burn is one flat charge per bundle, both pay it twice.
 *
 * Raising the cap to swallow 119 in one bundle would need ~14.2M gas on Hard
 * (85% of the cap), which is too little margin for a bundler overhead figure we
 * have not measured against a real smart wallet.
 */
const MAX_BATCH_SIZE = Number(process.env.NEXT_PUBLIC_BATCH_QUEST_MAX_SIZE || 100);

const SECONDS_PER_BLOCK = 2;

/** Coalesce simultaneous building-domain refresh requests into one land sweep. */
const REFRESH_DEBOUNCE_MS = 900;

const embeddedSurfaceClassName =
  "chromatic-white-surface rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-4 shadow-[var(--shadow-hairline)]";

const CENSUS_ROWS: Array<{ state: QuestSlotState; label: string; alwaysShow?: boolean }> = [
  { state: "available", label: "Idle", alwaysShow: true },
  { state: "in_progress", label: "On adventure" },
  { state: "ready_to_commit", label: "Returning" },
  { state: "committed", label: "Loot bags" },
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

export default function BatchQuestStartCard({
  lands,
  onSuccess,
  variant = "card",
  showWhenEmpty = false,
  className,
}: BatchQuestStartCardProps) {
  const [loading, setLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<QuestSlotSnapshot[]>([]);
  const [scanBlock, setScanBlock] = useState<bigint>(BigInt(0));
  const [lastScannedLandIds, setLastScannedLandIds] = useState<string>("");
  const [unreadableLands, setUnreadableLands] = useState(0);
  // The flat fee is charged once per run, not once per bundle. A fleet larger
  // than MAX_BATCH_SIZE still costs BURN_AMOUNT_TOKENS in total.
  const [runPaid, setRunPaid] = useState(false);
  const [totalSentThisSession, setTotalSentThisSession] = useState(0);
  const [txKey, setTxKey] = useState(0);
  const [difficulty, setDifficulty] = useState<QuestDifficultyId>(DEFAULT_BATCH_QUEST_DIFFICULTY);

  const { isLoading: smartWalletLoading, isSmartWallet } = useSmartWallet();
  const { pixotchiBalance } = useBalances();
  const { address } = useAccount();
  const rewards = useQuestRewardsAvailability();

  // Guards against a slow scan for a previous land set overwriting a newer one.
  const scanTokenRef = useRef(0);

  useEffect(() => {
    setDifficulty(loadBatchQuestDifficulty());
  }, []);

  const pixotchiBalanceNum = parseFloat(formatUnits(pixotchiBalance, 18));
  const burnAmountWei = useMemo(() => parseUnits(BURN_AMOUNT_TOKENS.toString(), 18), []);
  const shouldBurn = !runPaid;
  const hasEnoughTokens = !shouldBurn || pixotchiBalance >= burnAmountWei;

  const landIdsHash = useMemo(
    () => lands.map((land) => land.tokenId.toString()).sort().join(","),
    [lands],
  );

  // Re-read on every land-set change so a different wallet or holdings starts a
  // fresh, unpaid run.
  useEffect(() => {
    setRunPaid(isBatchQuestRunPaid(landIdsHash));
  }, [landIdsHash]);

  const scanQuests = useCallback(async () => {
    if (lands.length === 0) {
      setSnapshots([]);
      setLastScannedLandIds(landIdsHash);
      return;
    }

    const token = ++scanTokenRef.current;
    setLoading(true);

    try {
      const readClient = getReadClient();
      const [currentBlock, batch] = await Promise.all([
        readClient.getBlockNumber(),
        getQuestSlotsBatch(
          lands.map((land) => land.tokenId),
          { readClient },
        ),
      ]);

      if (token !== scanTokenRef.current) return;

      setScanBlock(currentBlock);
      setSnapshots(toQuestSlotSnapshots(batch, currentBlock));
      setUnreadableLands(batch.filter((entry) => !entry.ok).length);
      setLastScannedLandIds(landIdsHash);
    } catch (error) {
      console.error("Failed to scan farmer quest slots:", error);
      if (token === scanTokenRef.current) {
        setLastScannedLandIds(landIdsHash);
      }
    } finally {
      if (token === scanTokenRef.current) {
        setLoading(false);
      }
    }
  }, [landIdsHash, lands]);

  useEffect(() => {
    if (landIdsHash !== lastScannedLandIds) {
      void scanQuests();
      setTotalSentThisSession(0);
      setTxKey(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landIdsHash]);

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        void scanQuests();
      }, REFRESH_DEBOUNCE_MS);
    };

    window.addEventListener("buildings:refresh", handler);
    return () => {
      if (debounce) clearTimeout(debounce);
      window.removeEventListener("buildings:refresh", handler);
    };
  }, [scanQuests]);

  const counts = useMemo(() => {
    const tally: Record<QuestSlotState, number> = {
      available: 0,
      committed: 0,
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
    if (!runPaid || snapshots.length === 0 || idleSlots.length > 0) return;
    clearBatchQuestRun();
    setRunPaid(false);
  }, [idleSlots.length, runPaid, snapshots.length]);

  const totalBatches = Math.ceil(idleSlots.length / MAX_BATCH_SIZE);
  const hasMultipleBatches = idleSlots.length > MAX_BATCH_SIZE;
  const currentBatchSlots = useMemo(
    () => idleSlots.slice(0, MAX_BATCH_SIZE),
    [idleSlots],
  );

  const calls = useMemo(() => {
    if (currentBatchSlots.length === 0) return [];

    const startCalls = currentBatchSlots.map((slot) =>
      buildQuestStartCall(slot.landId, difficulty, slot.slotIndex),
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
  }, [burnAmountWei, currentBatchSlots, difficulty, shouldBurn]);

  const batchQuestIntentKey = useMemo(() => {
    const pairs = [...currentBatchSlots]
      .sort((a, b) => {
        if (a.landId < b.landId) return -1;
        if (a.landId > b.landId) return 1;
        return a.slotIndex - b.slotIndex;
      })
      .map((slot) => `${slot.landId}/${slot.slotIndex}`)
      .join(",");
    return `batch-quest-start:${difficulty}:${shouldBurn ? "burn" : "paid"}:${pairs}`;
  }, [currentBatchSlots, difficulty, shouldBurn]);

  const handleDifficultyChange = useCallback((nextValue: string | number) => {
    const parsed = Number(nextValue);
    if (!isQuestDifficultyId(parsed)) return;
    setDifficulty(parsed);
    storeBatchQuestDifficulty(parsed);
  }, []);

  const scanPending = lands.length > 0 && landIdsHash !== lastScannedLandIds;

  if ((loading || (showWhenEmpty && scanPending)) && snapshots.length === 0) {
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

  const hasAnySlots = snapshots.length > 0;

  if (!hasAnySlots && !showWhenEmpty) return null;

  const censusRows = CENSUS_ROWS.filter((row) => row.alwaysShow || counts[row.state] > 0);

  const content = (
    <>
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <span className="font-semibold">Batch Quests</span>
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
        <div className="rounded-[var(--radius-control)] border border-border/45 bg-background/45 p-3 text-sm text-muted-foreground">
          None of your lands have a Farmer House yet. Upgrade one to unlock farmer
          slots and send them on quests.
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

          {unreadableLands > 0 && (
            <div className="rounded-[var(--radius-control)] border border-[hsl(var(--info)/0.22)] bg-[hsl(var(--info)/0.1)] p-2">
              <div className="flex items-center gap-2 text-xs text-[hsl(var(--info))]">
                <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                <span>
                  {unreadableLands} land{unreadableLands === 1 ? "" : "s"} could not be
                  read, so farmers there are not counted yet. Reopen this panel to retry.
                </span>
              </div>
            </div>
          )}

          {(counts.ready_to_commit > 0 || counts.committed > 0) && (
            <div className="rounded-[var(--radius-control)] border border-border/45 bg-background/45 p-2 text-xs text-muted-foreground">
              Recalling farmers and opening loot bags stays per-land in the Farmer
              House, so every quest keeps its own reward roll.
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
                ariaLabel: `${entry.label} quest, ${entry.durationHours} hours`,
                label: (
                  <span>
                    {entry.label}{" "}
                    <span className="text-xs text-muted-foreground">({entry.durationHours}h)</span>
                  </span>
                ),
                value: String(entry.id),
              }))}
              value={String(difficulty)}
            />
          </div>
          )}

          {hasMultipleBatches && (
            <div className="rounded-[var(--radius-control)] border border-[hsl(var(--info)/0.22)] bg-[hsl(var(--info)/0.1)] p-2">
              <div className="flex items-center gap-2 text-xs text-[hsl(var(--info))]">
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

          {idleSlots.length === 0 ? (
            <div className="rounded-[var(--radius-control)] border border-border/45 bg-background/45 p-3 text-sm text-muted-foreground">
              No idle farmers right now. They will show up here as quests finish and
              cooldowns expire.
            </div>
          ) : rewards.isUnavailable ? (
            <div className="space-y-1 rounded-[var(--radius-control)] border border-amber-500/20 bg-amber-500/10 p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-value">
                <Lock className="h-3 w-3" />
                Rewards Pool Refilling
              </div>
              <div className="text-[10px] text-muted-foreground">
                Starting new quests is paused until the Farmer House reward wallet is
                refilled and approved.
              </div>
            </div>
          ) : !smartWalletLoading && !isSmartWallet ? (
            <div className="space-y-2 rounded-[var(--radius-control)] border border-primary/20 bg-primary/10 p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-primary">
                <Lock className="h-3 w-3" />
                Smart Wallet Required
              </div>
            </div>
          ) : !hasEnoughTokens ? (
            <div className="space-y-1 rounded-[var(--radius-control)] border border-amber-500/20 bg-amber-500/10 p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-value">
                <Lock className="h-3 w-3" />
                Insufficient PIXOTCHI Balance
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">
                Required: {BURN_AMOUNT_TOKENS.toLocaleString()} to burn | Balance:{" "}
                {pixotchiBalanceNum.toFixed(2)}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1 text-xs">
                <span className="text-muted-foreground">Cost:</span>
                {shouldBurn ? (
                  <span className="font-mono font-semibold text-primary">
                    {BURN_AMOUNT_TOKENS.toLocaleString()} PIXOTCHI
                  </span>
                ) : (
                  <span className="font-semibold text-[hsl(var(--success-strong))]">
                    Already paid this run
                  </span>
                )}
              </div>
              <SmartWalletTransaction
                key={txKey}
                intentKey={batchQuestIntentKey}
                calls={calls}
                buttonText={
                  hasMultipleBatches
                    ? `${shouldBurn ? "Burn & " : ""}Send Batch (${currentBatchSlots.length})`
                    : `${shouldBurn ? "Burn & " : ""}Send ${currentBatchSlots.length} Farmer${currentBatchSlots.length === 1 ? "" : "s"}`
                }
                buttonClassName="h-11 min-h-11 w-full text-sm font-bold"
                disabled={!rewards.isReady || smartWalletLoading}
                onSuccess={(tx) => {
                  const sentCount = currentBatchSlots.length;
                  const remainingCount = idleSlots.length - sentCount;
                  const newTotalSent = totalSentThisSession + sentCount;

                  setTotalSentThisSession(newTotalSent);
                  setTxKey((key) => key + 1);

                  // Record the fee before anything else so a follow-up bundle
                  // can never be charged twice for the same run.
                  if (shouldBurn) {
                    markBatchQuestRunPaid(landIdsHash);
                    setRunPaid(true);
                  }

                  const feeNote = shouldBurn
                    ? `Burned ${BURN_AMOUNT_TOKENS.toLocaleString()} PIXOTCHI & sent`
                    : "Sent";

                  if (remainingCount > 0) {
                    toast.success(
                      `${feeNote} ${sentCount} farmers! ${remainingCount} left - no extra fee.`,
                    );
                  } else {
                    toast.success(`${feeNote} all ${newTotalSent} farmers!`);
                  }

                  onSuccess?.();
                  // buildings:refresh drives the re-scan through the debounced
                  // listener above, so no direct scanQuests() call here.
                  dispatchPostTransactionRefresh(["buildings:refresh"], undefined, {
                    address,
                    source: "batch-quest-start",
                    transactionHash: extractTransactionHash(tx),
                  });

                  try {
                    const payload: Record<string, UntypedValue> = {
                      address,
                      taskId: "s3_send_quest",
                    };
                    const txHash = extractTransactionHash(tx);
                    if (txHash) {
                      payload.proof = { txHash };
                    }
                    postMissionProgress(payload);
                  } catch {
                    // Mission tracking is best-effort and must never block the send.
                  }
                }}
                onError={() => toast.error("Batch send failed")}
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
      <CardContent className="space-y-3 p-4">{content}</CardContent>
    </Card>
  );
}
