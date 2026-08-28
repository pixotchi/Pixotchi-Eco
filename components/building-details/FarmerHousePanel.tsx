"use client";

import SponsoredTransaction from '@/components/transactions/sponsored-transaction';
import { ProgressBar } from '@/components/ui/progress-bar';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { useQuestRewardsAvailability } from '@/hooks/useQuestRewardsAvailability';
import { getQuestSlotsByLandId,LAND_CONTRACT_ADDRESS } from '@/lib/contracts';
import { postMissionProgress } from '@/lib/mission-tracking';
import { useTabVisibility } from '@/lib/tab-visibility-context';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { landAbi } from '@/public/abi/pixotchi-v3-abi';
import React from 'react';
import { toast } from 'react-hot-toast';
import { useAccount,useBlockNumber } from 'wagmi';

interface FarmerHousePanelProps {
  landId: bigint;
  farmerHouseLevel: number;
  onQuestUpdate: () => void;
}

const QUEST_SLOT_SURFACE_CLASS = 'chromatic-white-surface flex flex-col gap-2 rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-hairline)]';
const QUEST_START_SURFACE_CLASS = 'building-subpanel-surface rounded-[var(--radius-control)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-2';
const QUEST_STATUS_PILL_CLASS = 'chromatic-white-surface rounded-[var(--radius-control)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] px-2 py-1 text-xs text-muted-foreground shadow-[var(--shadow-hairline)]';

export default function FarmerHousePanel({ landId, farmerHouseLevel, onQuestUpdate }: FarmerHousePanelProps) {
  const { address } = useAccount();
  const { isTabVisible } = useTabVisibility();
  const isDashboardVisible = isTabVisible('dashboard');
  const [slots, setSlots] = React.useState<import('@/lib/contracts').QuestSlot[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);
  const [currentBlock, setCurrentBlock] = React.useState<bigint>(BigInt(0));
  const [difficulty, setDifficulty] = React.useState<Record<number, number>>({});
  // Resolved from diamond storage, not env: setQuestRewardsWallet can rotate the
  // payer, and the NEXT_PUBLIC_QUEST_* vars silently point at the pre-rotation
  // constant when unset, which reads as an empty pool and locks the panel.
  const { isReady: isRewardsReady, isUnavailable: isRewardsUnavailable } =
    useQuestRewardsAvailability(isDashboardVisible);
  const questActionsBlocked = isRewardsUnavailable || !isRewardsReady;

  const fetchSlots = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getQuestSlotsByLandId(landId);
      setSlots(data);
    } catch {
      setError('Failed to load quests');
    } finally {
      setLoading(false);
    }
  }, [landId]);

  React.useEffect(() => {
    fetchSlots();
  }, [fetchSlots]);

  // Initialize and watch the current block number immediately to avoid transient wrong UI
  const { data: liveBlock } = useBlockNumber({
    watch: isDashboardVisible,
    query: {
      refetchInterval: isDashboardVisible ? 3000 : false,
    },
  });
  React.useEffect(() => {
    if (typeof liveBlock === 'bigint' && liveBlock > BigInt(0)) setCurrentBlock(liveBlock);
  }, [liveBlock]);

  const statusOf = (s: import('@/lib/contracts').QuestSlot): string => {
    // Until we know the current block, avoid guessing to prevent huge time estimates
    if (currentBlock === BigInt(0)) return 'Loading';
    const now = currentBlock;
    if (s.coolDownBlock !== BigInt(0) && now < s.coolDownBlock) return 'Cooldown';
    if (s.startBlock === BigInt(0)) return 'Available';
    if (now >= s.startBlock && now <= s.endBlock) return 'In progress';
    if (now > s.endBlock && s.pseudoRndBlock === BigInt(0)) return 'Ready to commit';
    if (s.pseudoRndBlock !== BigInt(0)) return 'Committed';
    return 'Available';
  };

  const progressPct = (s: import('@/lib/contracts').QuestSlot) => {
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
    await fetchSlots();
    onQuestUpdate();
    // Ensure building/land UI reflects changes immediately
    try { window.dispatchEvent(new Event('buildings:refresh')); } catch { }

    // Optional: poll for desired status transition using fresh reads (avoids stale state)
    if (opts && typeof opts.slotIndex === 'number' && (opts.awaitCommitted || opts.awaitUncommitted || opts.awaitInProgress)) {
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const fresh = await getQuestSlotsByLandId(landId);
          const s = fresh?.[opts.slotIndex];
          const st = s ? statusOf(s) : undefined;
          if (opts.awaitCommitted && st === 'Committed') break;
          if (opts.awaitUncommitted && st !== 'Committed') break;
          if (opts.awaitInProgress && st === 'In progress') break;
        } catch { }
      }
      await fetchSlots();
    }
  }

  return (
    <div className="space-y-3 pt-2">
      <h4 className="font-semibold text-sm text-center">Quests</h4>
      {loading ? (
        <div className="text-center text-muted-foreground text-sm">Loading…</div>
      ) : error ? (
        <div className="text-center text-destructive text-sm">{error}</div>
      ) : (
        <>
          {isRewardsUnavailable && (
            <div className="rounded-md border border-amber-300 bg-amber-100/60 px-3 py-2 text-xs text-amber-900">
              Farmer House rewards wallet is being refilled or approved. Starting new quests and opening loot bags are paused to prevent failed transactions.
            </div>
          )}
          <div className="grid grid-cols-1 gap-2">
            {slots.slice(0, Math.min(farmerHouseLevel ?? 3, 3)).map((s, idx) => (
              <div key={idx} className={QUEST_SLOT_SURFACE_CLASS}>
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    <div className="font-medium">Slot {idx + 1}</div>
                    <div className="text-xs text-muted-foreground">{statusOf(s)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusOf(s) === 'Loading' && (
                      <div className={QUEST_STATUS_PILL_CLASS}>Loading…</div>
                    )}
                    {statusOf(s) === 'Ready to commit' && (
                      <SponsoredTransaction
                        calls={[{ address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'questCommit', args: [landId, BigInt(idx)] }]}
                        buttonText="Return now"
                        buttonClassName="h-11 min-h-11 px-3 text-xs"
                        hideStatus
                        onSuccess={() => handleSuccess({ slotIndex: idx, awaitCommitted: true })}
                      />
                    )}
                    {statusOf(s) === 'Committed' && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Loot bag ready</span>
                        <SponsoredTransaction
                          calls={[{ address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'questFinalize', args: [landId, BigInt(idx)] }]}
                          buttonText="Open now"
                          buttonClassName="h-11 min-h-11 px-3 text-xs"
                          hideStatus
                          disabled={questActionsBlocked}
                          onSuccess={() => { toast.success('Loot bag opened!'); handleSuccess({ slotIndex: idx, awaitUncommitted: true }); }}
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
                {statusOf(s) === 'Available' && (
                  <>
                    <div className={`${QUEST_START_SURFACE_CLASS} grid gap-2 sm:grid-cols-[1fr,auto] items-center`}>
                      <div className="overflow-x-auto sm:overflow-visible">
                        <ToggleGroup
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
                      <SponsoredTransaction
                        calls={[{ address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'questStart', args: [landId, BigInt(difficulty[idx] ?? 0), BigInt(idx)] }]}
                        buttonText="Start"
                        buttonClassName="h-11 min-h-11 px-3 text-xs w-full sm:w-auto shrink-0"
                        hideStatus
                        disabled={questActionsBlocked}
                        onSuccess={(tx: UntypedValue) => {
                          handleSuccess({ slotIndex: idx, awaitInProgress: true });
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
            {slots.length === 0 && (
              <div className="chromatic-white-surface rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3 text-center text-sm text-muted-foreground shadow-[var(--shadow-hairline)]">No quest slots available.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
