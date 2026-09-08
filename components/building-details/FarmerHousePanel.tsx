"use client";

import GameTransaction from '@/components/transactions/game-transaction';
import { useLandQuestSlots } from '@/hooks/useLandQuestSlots';
import { ResourceState } from '@/components/ui/resource-state';
import { ProgressBar } from '@/components/ui/progress-bar';
import { QuestDifficultySelector } from './quest-difficulty-selector';
import { QuestDifficultySummary } from './quest-difficulty-summary';
import { useQuestRewardsAvailability } from '@/hooks/useQuestRewardsAvailability';
import { LAND_CONTRACT_ADDRESS, getReadClient } from '@/lib/contracts';
import { requireQuestFinalizeReady } from '@/lib/quest-rewards-readiness';
import { getQuestSlotState, getUnlockedQuestSlots, type QuestSlot, type QuestSlotState } from '@/lib/quest-slots';
import { postMissionProgress } from '@/lib/mission-tracking';
import { useTabVisibility } from '@/lib/tab-visibility-context';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { landAbi } from '@/public/abi/pixotchi-v3-abi';
import { useQuestConfiguration } from '@/hooks/useQuestConfiguration';
import { formatDurationSeconds } from '@/lib/duration-display';
import { BASE_SECONDS_PER_BLOCK, formatUpgradeDuration } from '@/lib/utils';
import React from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { describeQuestResult, getQuestFinalizeResult, loadQuestResult, saveQuestResult, questResultScope, questFinalizeBlocksRemaining, QUEST_FINALIZE_EXPIRY_BLOCKS, QUEST_EXPIRED_STATUS, type QuestFinalizeResult } from '@/lib/quest-ui';
export { getQuestFinalizeOutcome, isQuestFinalizeExpired, QUEST_EXPIRED_STATUS, type QuestFinalizeOutcome } from '@/lib/quest-ui';
import { useAccount,useBlockNumber } from 'wagmi';

interface FarmerHousePanelProps {
  landId: bigint;
  farmerHouseLevel: number;
  onQuestUpdate: () => void;
}

const QUEST_SLOT_SURFACE_CLASS = 'flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border bg-card p-3';
const QUEST_START_SURFACE_CLASS = 'pt-1';
const QUEST_STATUS_PILL_CLASS = 'rounded-[var(--radius-control)] bg-muted px-2 py-1 text-xs text-muted-foreground';
const QUEST_RECONCILE_DELAYS_MS = [500, 1_000, 1_500, 2_500, 4_000, 6_000] as const;

export default function FarmerHousePanel({ landId, farmerHouseLevel, onQuestUpdate }: FarmerHousePanelProps) {
  const questConfiguration = useQuestConfiguration();
  const { address } = useAccount();
  const { isTabVisible } = useTabVisibility();
  const isDashboardVisible = isTabVisible('dashboard');
  const scope = questResultScope(address, landId);
  const currentScopeRef = React.useRef(scope);
  currentScopeRef.current = scope;
  const [recentResults, setRecentResults] = React.useState<{ scope: string; slots: Record<number, QuestFinalizeResult> }>({ scope, slots: {} });
  const [difficulty, setDifficulty] = React.useState<Record<number, number>>({});
  const currentLandIdRef = React.useRef(landId);
  currentLandIdRef.current = landId;
  // Resolved from diamond storage, not env: setQuestRewardsWallet can rotate the
  // payer, and the NEXT_PUBLIC_QUEST_* vars silently point at the pre-rotation
  // constant when unset, which reads as an empty pool and locks the panel.
  const { isReady: isRewardsReady, isUnavailable: isRewardsUnavailable,
    isRefreshing: isRewardsRefreshing, error: rewardsError, refresh: refreshRewards, requireReady: requireRewardsReady } =
    useQuestRewardsAvailability(isDashboardVisible);
  const questActionsBlocked = isRewardsUnavailable || !isRewardsReady;
  const validateQuestReturn = async () => {
    await requireRewardsReady();
    if (currentScopeRef.current !== scope) {
      throw new Error('Your wallet or land changed. Review the selected quest before returning.');
    }
  };

  const { slots: currentSlots, loading, error, refresh: fetchSlots } = useLandQuestSlots({
    owner: address, chainId: 8453, landId, enabled: farmerHouseLevel > 0,
  });

  React.useEffect(() => {
    setDifficulty({});
    const stored: Record<number, QuestFinalizeResult> = {};
    try {
      for (let slot = 0; slot < 3; slot += 1) {
        const result = loadQuestResult(window.sessionStorage, scope, slot);
        if (result) stored[slot] = result;
      }
    } catch { /* Session storage may be disabled. */ }
    setRecentResults({ scope, slots: stored });
  }, [scope]);

  // The land overview owns the watcher; this observer shares its Base block.
  const { data: liveBlock } = useBlockNumber({ chainId: 8453, watch: false });
  const currentBlock = liveBlock ?? BigInt(0);

  const stateOf = (slot: QuestSlot): QuestSlotState | 'loading' => currentBlock === BigInt(0) ? 'loading' : getQuestSlotState(slot, currentBlock);
  const statusOf = (slot: QuestSlot): string => ({
    loading: 'Loading', available: 'Available', cooldown: 'Cooldown', in_progress: 'In progress',
    ready_to_commit: 'Ready to return', committed: 'Loot bag ready', expired: QUEST_EXPIRED_STATUS,
  })[stateOf(slot)];

  const progressPct = (s: QuestSlot) => {
    if (s.startBlock === BigInt(0)) return 0;
    const total = Number(s.endBlock - s.startBlock);
    const done = Math.max(0, Math.min(total, Number(currentBlock - s.startBlock)));
    return total <= 0 ? 0 : (done / total) * 100;
  };
  const blocksLeft = (target: bigint) => target > currentBlock ? target - currentBlock : BigInt(0);
  const blockTimeRemaining = (blocks: bigint) => formatDurationSeconds(blocks * BigInt(BASE_SECONDS_PER_BLOCK));
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
          const st = s ? stateOf(s) : undefined;
          if (opts.awaitCommitted && st === 'committed') break;
          if (opts.awaitUncommitted && s?.pseudoRndBlock === BigInt(0)) break;
          if (opts.awaitInProgress && st === 'in_progress') break;
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
    <div className="space-y-4">
      <h4 className="font-semibold text-sm">Quests</h4>
      {loading ? (
        <ResourceState status="loading" title="Loading quests…" description="Checking your farmers and quest slots." className="min-h-32" />
      ) : error ? (
        <div className="space-y-2 text-center text-sm">
          <p role="alert" className="text-destructive">{error}</p>
          <Button type="button" variant="outline" onClick={() => void fetchSlots()}>Retry quests</Button>
        </div>
      ) : (
        <>
          {questActionsBlocked && (
            <div role="status" className="space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <p>{rewardsError
                ? "We couldn't check quest rewards. Retry before starting or returning. Existing loot bags can still be checked and opened."
                : isRewardsUnavailable
                  ? 'Quest rewards are temporarily unavailable. New quests and returning farmers are paused. Existing loot bags can still be checked and opened.'
                  : 'Checking quest rewards…'}</p>
              <Button type="button" size="sm" variant="outline" disabled={isRewardsRefreshing} onClick={() => void refreshRewards()}>
                {isRewardsRefreshing ? 'Checking rewards…' : 'Retry rewards'}
              </Button>
            </div>
          )}
          <div className="grid grid-cols-1 gap-2">
            {getUnlockedQuestSlots(currentSlots, farmerHouseLevel).map((s, idx) => (
              <div key={idx} className={QUEST_SLOT_SURFACE_CLASS}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-sm">
                    <div className="font-medium">Slot {idx + 1}</div>
                    <div className="text-xs text-muted-foreground">{statusOf(s)}</div>
                  </div>
                  <div className="flex w-full min-w-0 flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
                    {stateOf(s) === 'loading' && (
                      <div className={QUEST_STATUS_PILL_CLASS}>Loading...</div>
                    )}
                    {stateOf(s) === 'ready_to_commit' && (
                      <GameTransaction
                        effects="none"
                        intentKey={`quest:commit:${landId}:${idx}`}
                        calls={[{ address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'questCommit', args: [landId, BigInt(idx)] }]}
                        buttonText="Return now"
                        buttonClassName="h-11 min-h-11 w-full px-3 text-sm sm:w-auto"
                        hideStatus
                        disabled={questActionsBlocked}
                        onButtonClick={validateQuestReturn}
                        onSuccess={() => handleSuccess({ slotIndex: idx, awaitCommitted: true })}
                      />
                    )}
                    {stateOf(s) === 'committed' && (
                      <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                                                <GameTransaction
                          successFeedback="feature"
                          effects={{ domains: ["balances"] }}
                          intentKey={`quest:finalize:${landId}:${idx}`}
                          calls={[{ address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'questFinalize', args: [landId, BigInt(idx)] }]}
                          buttonText="Open now"
                          buttonClassName="h-11 min-h-11 w-full px-3 text-sm sm:w-auto"
                          hideStatus
                          disabled={!address}
                          onButtonClick={async () => {
                            if (!address) throw new Error('Connect the wallet that owns this quest.');
                            await requireQuestFinalizeReady(async () => {
                              const simulation = await getReadClient().simulateContract({
                                account: address, address: LAND_CONTRACT_ADDRESS, abi: landAbi,
                                functionName: 'questFinalize', args: [landId, BigInt(idx)],
                              });
                              if (!simulation.result[0]) void fetchSlots();
                              return simulation.result[0];
                            }, () => currentScopeRef.current === scope);
                          }}
                          onSuccess={(tx: unknown) => handleFinalizeSuccess(tx, idx)}
                        />
                      </div>
                    )}
                    {stateOf(s) === 'expired' && (
                      <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                        <span className="text-xs text-amber-700">Loot bag expired; reset required</span>
                        <GameTransaction
                          successFeedback="feature"
                          effects={{ domains: ["balances"] }}
                          intentKey={`quest:finalize:${landId}:${idx}`}
                          calls={[{ address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'questFinalize', args: [landId, BigInt(idx)] }]}
                          buttonText="Reset expired quest"
                          buttonClassName="h-11 min-h-11 w-full px-3 text-sm sm:w-auto"
                          hideStatus
                          onSuccess={(tx: unknown) => handleFinalizeSuccess(tx, idx)}
                        />
                      </div>
                    )}
                    {stateOf(s) === 'cooldown' && (
                      <div className={QUEST_STATUS_PILL_CLASS}>
                        ~{blockTimeRemaining(blocksLeft(s.coolDownBlock))} left
                      </div>
                    )}
                  </div>
                </div>
                {stateOf(s) === 'ready_to_commit' && (
                  <p className="text-xs text-[hsl(var(--warning-strong))]">{questActionsBlocked ? 'Your farmer can safely wait here. The opening deadline starts only after returning. ' : ''}After returning, open the loot bag within {formatUpgradeDuration(QUEST_FINALIZE_EXPIRY_BLOCKS)} ({QUEST_FINALIZE_EXPIRY_BLOCKS.toString()} blocks) or the reward expires. Opening requires a second transaction.</p>
                )}
                {stateOf(s) === 'committed' && (
                  <p className="text-xs font-medium text-[hsl(var(--warning-strong))]">
                    {questFinalizeBlocksRemaining(s, currentBlock) === BigInt(0)
                      ? 'Final eligible block — open immediately. The reward expires next block.'
                      : `Open within ~${blockTimeRemaining(questFinalizeBlocksRemaining(s, currentBlock))} (${questFinalizeBlocksRemaining(s, currentBlock)} blocks) or the reward expires.`}
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
                {stateOf(s) === 'available' && (
                  <>
                    <div className={`${QUEST_START_SURFACE_CLASS} grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] items-center`}>
                      <div className="overflow-x-auto sm:overflow-visible">
                        <QuestDifficultySelector
                          label={`Quest ${idx + 1} difficulty`}
                          value={difficulty[idx] ?? 0}
                          durationLabels={questConfiguration.isReady ? questConfiguration.data?.difficulties.map(item => formatUpgradeDuration(item.durationInBlocks)) : undefined}
                          onChange={value => setDifficulty(prev => ({ ...prev, [idx]: value }))}
                        />
                      </div>
                      <GameTransaction
                        effects="none"
                        intentKey={`quest:start:${landId}:${idx}`}
                        calls={[{ address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'questStart', args: [landId, BigInt(difficulty[idx] ?? 0), BigInt(idx)] }]}
                        buttonText="Start"
                        buttonClassName="h-11 min-h-11 px-3 text-sm w-full sm:w-auto shrink-0"
                        hideStatus
                        disabled={questActionsBlocked || !questConfiguration.isReady}
                        onButtonClick={async () => {
                          if (!questConfiguration.isReady || !questConfiguration.data) throw new Error('Check the quest terms before starting.');
                          await requireRewardsReady(questConfiguration.data);
                          if (currentScopeRef.current !== scope) throw new Error('Your wallet or land changed. Review the quest again.');
                        }}
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
                    <QuestDifficultySummary value={difficulty[idx] ?? 0} />
                    {isRewardsUnavailable && (
                      <p className="text-xs text-amber-800 sm:col-span-2">
                        Wait until rewards are available before sending a new quest.
                      </p>
                    )}
                  </>
                )}
                {stateOf(s) === 'in_progress' && (
                  <div className="space-y-1">
                    <ProgressBar label={`Quest ${idx + 1} progress`} value={progressPct(s)} />
                    <div className="text-xs text-muted-foreground">Ends in ~{blockTimeRemaining(blocksLeft(s.endBlock))}</div>
                  </div>
                )}
              </div>
            ))}
            {currentSlots.length === 0 && (
              <div className="p-3 text-center text-sm text-muted-foreground">No quest slots available.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
