"use client";

import GameTransaction from '@/components/transactions/game-transaction';
import { useDocumentVisible } from "@/hooks/useDocumentVisible";
import { ProgressBar } from '@/components/ui/progress-bar';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { useQuestRewardsAvailability } from '@/hooks/useQuestRewardsAvailability';
import { getQuestSlotState, getQuestSlotsByLandId, LAND_CONTRACT_ADDRESS, type QuestSlot } from '@/lib/contracts';
import { postMissionProgress } from '@/lib/mission-tracking';
import { useTabVisibility } from '@/lib/tab-visibility-context';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { landAbi } from '@/public/abi/pixotchi-v3-abi';
import React from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { describeQuestResult, getQuestFinalizeResult, loadQuestResult, saveQuestResult, questResultScope, questFinalizeBlocksRemaining, QUEST_EXPIRED_STATUS, type QuestFinalizeResult } from '@/lib/quest-ui';
export { getQuestFinalizeOutcome, isQuestFinalizeExpired, QUEST_EXPIRED_STATUS, type QuestFinalizeOutcome } from '@/lib/quest-ui';
import { useAccount,useBlockNumber } from 'wagmi';

interface FarmerHousePanelProps {
  landId: bigint;
  farmerHouseLevel: number;
  onQuestUpdate: () => void;
}

const QUEST_SLOT_SURFACE_CLASS = 'chromatic-white-surface flex flex-col gap-2 rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-hairline)]';
const QUEST_START_SURFACE_CLASS = 'building-subpanel-surface rounded-[var(--radius-control)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-2';
const QUEST_STATUS_PILL_CLASS = 'chromatic-white-surface rounded-[var(--radius-control)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] px-2 py-1 text-xs text-muted-foreground shadow-[var(--shadow-hairline)]';
const QUEST_RECONCILE_DELAYS_MS = [500, 1_000, 1_500, 2_500, 4_000, 6_000] as const;

export default function FarmerHousePanel({ landId, farmerHouseLevel, onQuestUpdate }: FarmerHousePanelProps) {
  const { address } = useAccount();
  const { isTabVisible } = useTabVisibility();
  const isDashboardVisible = isTabVisible('dashboard');
  const [slots, setSlots] = React.useState<import('@/lib/contracts').QuestSlot[]>([]);
  const scope = questResultScope(address, landId);
  const currentScopeRef = React.useRef(scope);
  currentScopeRef.current = scope;
  const [slotsScope, setSlotsScope] = React.useState<string | null>(null);
  const [recentResults, setRecentResults] = React.useState<{ scope: string; slots: Record<number, QuestFinalizeResult> }>({ scope, slots: {} });
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);
  const [currentBlock, setCurrentBlock] = React.useState<bigint>(BigInt(0));
  const [difficulty, setDifficulty] = React.useState<Record<number, number>>({});
  const currentLandIdRef = React.useRef(landId);
  const slotsRequestRef = React.useRef(0);
  currentLandIdRef.current = landId;
  // Resolved from diamond storage, not env: setQuestRewardsWallet can rotate the
  // payer, and the NEXT_PUBLIC_QUEST_* vars silently point at the pre-rotation
  // constant when unset, which reads as an empty pool and locks the panel.
  const { isReady: isRewardsReady, isUnavailable: isRewardsUnavailable } =
    useQuestRewardsAvailability(isDashboardVisible);
  const questActionsBlocked = isRewardsUnavailable || !isRewardsReady;

  const fetchSlots = React.useCallback(async () => {
    const requestLandId = landId;
    if (currentLandIdRef.current !== requestLandId || currentScopeRef.current !== scope) return null;
    const requestId = ++slotsRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await getQuestSlotsByLandId(requestLandId);
      if (
        requestId !== slotsRequestRef.current
        || currentLandIdRef.current !== requestLandId || currentScopeRef.current !== scope
      ) return null;
      setSlots(data);
      setSlotsScope(scope);
      return data;
    } catch {
      if (
        requestId !== slotsRequestRef.current
        || currentLandIdRef.current !== requestLandId || currentScopeRef.current !== scope
      ) return null;
      setSlots([]);
      setSlotsScope(null);
      setError('Failed to load quests');
      return null;
    } finally {
      if (
        requestId === slotsRequestRef.current
        && currentLandIdRef.current === requestLandId && currentScopeRef.current === scope
      ) setLoading(false);
    }
  }, [landId, scope]);

  React.useEffect(() => {
    slotsRequestRef.current += 1;
    setSlots([]);
    setSlotsScope(null);
    setError(null);
    setLoading(true);
    setDifficulty({});
    const stored: Record<number, QuestFinalizeResult> = {};
    try {
      for (let slot = 0; slot < 3; slot += 1) {
        const result = loadQuestResult(window.sessionStorage, scope, slot);
        if (result) stored[slot] = result;
      }
    } catch { /* Session storage may be disabled. */ }
    setRecentResults({ scope, slots: stored });
    void fetchSlots();
    return () => {
      slotsRequestRef.current += 1;
    };
  }, [fetchSlots, landId, scope]);

  const currentSlots = slotsScope === scope ? slots : [];

  // Initialize and watch the current block number immediately to avoid transient wrong UI.
  // ONE poller: `watch` alone drives viem's watchBlockNumber at the wagmi
  // config's pollingInterval — the extra refetchInterval used to run a second,
  // overlapping eth_blockNumber poll on the same query. Also gated on document
  // visibility so a backgrounded webview stops hitting the RPC.
  const isDocumentVisible = useDocumentVisible();
  const { data: liveBlock } = useBlockNumber({
    watch: isDashboardVisible && isDocumentVisible,
  });
  React.useEffect(() => {
    if (typeof liveBlock === 'bigint' && liveBlock > BigInt(0)) setCurrentBlock(liveBlock);
  }, [liveBlock]);

  React.useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') void fetchSlots(); };
    window.addEventListener('online', refresh);
    window.addEventListener('buildings:refresh', refresh);
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('buildings:refresh', refresh);
    };
  }, [fetchSlots]);
  const wasVisibleRef = React.useRef(isDashboardVisible && isDocumentVisible);
  React.useEffect(() => {
    const visible = isDashboardVisible && isDocumentVisible;
    if (visible && !wasVisibleRef.current) void fetchSlots();
    wasVisibleRef.current = visible;
  }, [fetchSlots, isDashboardVisible, isDocumentVisible]);

  const statusOf = (s: QuestSlot): string => {
    // Until we know the current block, avoid guessing to prevent huge time estimates
    if (currentBlock === BigInt(0)) return 'Loading';
    const labels = { available: 'Available', cooldown: 'Cooldown', in_progress: 'In progress', ready_to_commit: 'Ready to commit', committed: 'Committed', expired: QUEST_EXPIRED_STATUS };
    return labels[getQuestSlotState(s, currentBlock)];
  };

  const progressPct = (s: QuestSlot) => {
    if (s.startBlock === BigInt(0)) return 0;
    const total = Number(s.endBlock - s.startBlock);
    const done = Math.max(0, Math.min(total, Number(currentBlock - s.startBlock)));
    return total <= 0 ? 0 : (done / total) * 100;
  };
  const blocksLeft = (target: bigint) => Math.max(0, Number(target - currentBlock));
  const formatSeconds = (sec: number) => {
    if (sec <= 0) return '0s';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };
  const handleSuccess = async (opts?: { slotIndex?: number; awaitCommitted?: boolean; awaitUncommitted?: boolean; awaitInProgress?: boolean }) => {
    const operationLandId = landId;
    await fetchSlots();
    if (currentLandIdRef.current !== operationLandId || currentScopeRef.current !== scope) return;
    onQuestUpdate();
    // Ensure building/land UI reflects changes immediately
    try { window.dispatchEvent(new Event('buildings:refresh')); } catch { }

    // Optional: poll for desired status transition using fresh reads (avoids stale state)
    if (opts && typeof opts.slotIndex === 'number' && (opts.awaitCommitted || opts.awaitUncommitted || opts.awaitInProgress)) {
      for (const delayMs of QUEST_RECONCILE_DELAYS_MS) {
        await new Promise((r) => setTimeout(r, delayMs));
        if (currentLandIdRef.current !== operationLandId || currentScopeRef.current !== scope) return;
        try {
          const fresh = await fetchSlots();
          if (currentLandIdRef.current !== operationLandId || currentScopeRef.current !== scope) return;
          const s = fresh?.[opts.slotIndex];
          const st = s ? statusOf(s) : undefined;
          if (opts.awaitCommitted && st === 'Committed') break;
          if (opts.awaitUncommitted && s?.pseudoRndBlock === BigInt(0)) break;
          if (opts.awaitInProgress && st === 'In progress') break;
        } catch { }
      }
      await fetchSlots();
    }
  }

  const handleFinalizeSuccess = async (proof: unknown, slotIndex: number) => {
    const result = getQuestFinalizeResult(proof, landId, slotIndex);
    if (currentScopeRef.current !== scope) return;
    if (result.outcome !== 'unknown') {
      setRecentResults((previous) => ({ scope, slots: { ...(previous.scope === scope ? previous.slots : {}), [slotIndex]: result } }));
      try { saveQuestResult(window.sessionStorage, scope, slotIndex, result); } catch { /* Storage unavailable. */ }
    }
    const message = describeQuestResult(result, landId);
    if (result.outcome === 'finalized') toast.success(message);
    else if (result.outcome === 'reset') toast.error(message);
    else toast(message);
    await handleSuccess({ slotIndex, awaitUncommitted: true });
  };

  return (
    <div className="space-y-3 pt-2">
      <h4 className="font-semibold text-sm text-center">Quests</h4>
      {loading ? (
        <div className="text-center text-muted-foreground text-sm">Loading...</div>
      ) : error ? (
        <div className="space-y-2 text-center text-sm">
          <p role="alert" className="text-destructive">{error}</p>
          <Button type="button" variant="outline" onClick={() => void fetchSlots()}>Retry quests</Button>
        </div>
      ) : (
        <>
          {isRewardsUnavailable && (
            <div className="rounded-md border border-amber-300 bg-amber-100/60 px-3 py-2 text-xs text-amber-900">
              Farmer House rewards wallet is being refilled or approved. Starting new quests and opening loot bags are paused to prevent failed transactions.
            </div>
          )}
          <div className="grid grid-cols-1 gap-2">
            {currentSlots.slice(0, Math.min(farmerHouseLevel ?? 3, 3)).map((s, idx) => (
              <div key={idx} className={QUEST_SLOT_SURFACE_CLASS}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-sm">
                    <div className="font-medium">Slot {idx + 1}</div>
                    <div className="text-xs text-muted-foreground">{statusOf(s)}</div>
                  </div>
                  <div className="flex w-full min-w-0 flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
                    {statusOf(s) === 'Loading' && (
                      <div className={QUEST_STATUS_PILL_CLASS}>Loading...</div>
                    )}
                    {statusOf(s) === 'Ready to commit' && (
                      <GameTransaction
                        effects="none"
                        intentKey={`quest:commit:${landId}:${idx}`}
                        calls={[{ address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'questCommit', args: [landId, BigInt(idx)] }]}
                        buttonText="Return now"
                        buttonClassName="h-11 min-h-11 w-full px-3 text-xs sm:w-auto"
                        hideStatus
                        onSuccess={() => handleSuccess({ slotIndex: idx, awaitCommitted: true })}
                      />
                    )}
                    {statusOf(s) === 'Committed' && (
                      <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                        <span className="text-xs text-muted-foreground">Loot bag ready</span>
                        <GameTransaction
                          effects={{ domains: ["balances"] }}
                          intentKey={`quest:finalize:${landId}:${idx}`}
                          calls={[{ address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'questFinalize', args: [landId, BigInt(idx)] }]}
                          buttonText="Open now"
                          buttonClassName="h-11 min-h-11 w-full px-3 text-xs sm:w-auto"
                          hideStatus
                          disabled={questActionsBlocked}
                          onSuccess={(tx: unknown) => handleFinalizeSuccess(tx, idx)}
                        />
                      </div>
                    )}
                    {statusOf(s) === QUEST_EXPIRED_STATUS && (
                      <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                        <span className="text-xs text-amber-700">Loot bag expired; reset required</span>
                        <GameTransaction
                          effects={{ domains: ["balances"] }}
                          intentKey={`quest:finalize:${landId}:${idx}`}
                          calls={[{ address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'questFinalize', args: [landId, BigInt(idx)] }]}
                          buttonText="Reset expired quest"
                          buttonClassName="h-11 min-h-11 w-full px-3 text-xs sm:w-auto"
                          hideStatus
                          onSuccess={(tx: unknown) => handleFinalizeSuccess(tx, idx)}
                        />
                      </div>
                    )}
                    {statusOf(s) === 'Cooldown' && (
                      <div className={QUEST_STATUS_PILL_CLASS}>
                        ~{formatSeconds(blocksLeft(s.coolDownBlock) * 2)} left
                      </div>
                    )}
                  </div>
                </div>
                {statusOf(s) === 'Ready to commit' && (
                  <p className="text-xs text-[hsl(var(--warning-strong))]">After returning, open the loot bag within about 8½ minutes (256 blocks) or the reward expires. Opening requires a second transaction.</p>
                )}
                {statusOf(s) === 'Committed' && (
                  <p className="text-xs font-medium text-[hsl(var(--warning-strong))]">
                    {questFinalizeBlocksRemaining(s, currentBlock) === BigInt(0)
                      ? 'Final eligible block — open immediately. The reward expires next block.'
                      : `Open within ~${formatSeconds(Number(questFinalizeBlocksRemaining(s, currentBlock)) * 2)} (${questFinalizeBlocksRemaining(s, currentBlock)} blocks) or the reward expires.`}
                  </p>
                )}
                {recentResults.scope === scope && recentResults.slots[idx] && (
                  <div className="rounded-[var(--radius-control)] border border-border/60 bg-background/50 p-2 text-xs" role="status">
                    <div className="font-medium">Last quest result</div>
                    <p className="mt-1 break-words">{describeQuestResult(recentResults.slots[idx], landId)}</p>
                    {recentResults.slots[idx].outcome !== 'unknown' && recentResults.slots[idx].transactionHash && (
                      <a className="mt-1 inline-block underline underline-offset-2" href={`https://basescan.org/tx/${recentResults.slots[idx].transactionHash}`} target="_blank" rel="noopener noreferrer">View transaction</a>
                    )}
                  </div>
                )}
                {statusOf(s) === 'Available' && (
                  <>
                    <div className={`${QUEST_START_SURFACE_CLASS} grid gap-2 sm:grid-cols-[1fr,auto] items-center`}>
                      <div className="overflow-x-auto sm:overflow-visible">
                        <ToggleGroup
                          ariaLabel="Quest difficulty"
                          value={String(difficulty[idx] ?? 0)}
                          onValueChange={(v) => setDifficulty((prev) => ({ ...prev, [idx]: Number(v || 0) }))}
                          options={[
                            { value: '0', label: <span>Easy <span className="text-xs text-muted-foreground">(3h)</span></span> },
                            { value: '1', label: <span>Med <span className="text-xs text-muted-foreground">(6h)</span></span> },
                            { value: '2', label: <span>Hard <span className="text-xs text-muted-foreground">(12h)</span></span> },
                          ]}
                          className="bg-muted/50 border-primary/20"
                          getButtonClassName={(val, selected) => (
                            val === '0' ? (selected ? 'bg-[hsl(var(--success)/0.18)] text-[hsl(var(--success-strong))]' : 'text-[hsl(var(--success-strong))]') :
                              val === '1' ? (selected ? 'bg-[hsl(var(--warning)/0.18)] text-[hsl(var(--warning))]' : 'text-[hsl(var(--warning))]') :
                                (selected ? 'bg-destructive/15 text-destructive' : 'text-destructive')
                          )}
                        />
                      </div>
                      <GameTransaction
                        effects="none"
                        intentKey={`quest:start:${landId}:${idx}`}
                        calls={[{ address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'questStart', args: [landId, BigInt(difficulty[idx] ?? 0), BigInt(idx)] }]}
                        buttonText="Start"
                        buttonClassName="h-11 min-h-11 px-3 text-xs w-full sm:w-auto shrink-0"
                        hideStatus
                        disabled={questActionsBlocked}
                        onSuccess={async (tx: UntypedValue) => {
                          await handleSuccess({ slotIndex: idx, awaitInProgress: true });
                          try {
                            const payload: Record<string, UntypedValue> = { address, taskId: 's3_send_quest' };
                            const txHash = extractTransactionHash(tx);
                            if (txHash) {
                              payload.proof = { txHash };
                            }
                            postMissionProgress(payload);
                          } catch { }
                        }}
                      />
                    </div>
                    {isRewardsUnavailable && (
                      <p className="text-xs text-amber-800 sm:col-span-2">
                        Rewards pool is not ready yet. Please wait for it to refill or approve before sending new quests.
                      </p>
                    )}
                  </>
                )}
                {statusOf(s) === 'In progress' && (
                  <div className="space-y-1">
                    <ProgressBar label={`Quest ${idx + 1} progress`} value={progressPct(s)} />
                    <div className="text-xs text-muted-foreground">Ends in ~{formatSeconds(Math.max(0, Math.ceil(blocksLeft(s.endBlock) * 2)))}</div>
                  </div>
                )}
              </div>
            ))}
            {currentSlots.length === 0 && (
              <div className="chromatic-white-surface rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3 text-center text-sm text-muted-foreground shadow-[var(--shadow-hairline)]">No quest slots available.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
