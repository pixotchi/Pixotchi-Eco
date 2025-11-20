"use client";

import React from 'react';
import { useAccount, useBlockNumber } from 'wagmi';
import { getQuestSlotsByLandId, LAND_CONTRACT_ADDRESS, PIXOTCHI_TOKEN_ADDRESS, ERC20_BALANCE_ABI } from '@/lib/contracts';
import SponsoredTransaction from '@/components/transactions/sponsored-transaction';
import { landAbi } from '@/public/abi/pixotchi-v3-abi';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { toast } from 'react-hot-toast';
import { usePublicClient } from 'wagmi';
import { parseUnits } from 'viem';
import { extractTransactionHash } from '@/lib/transaction-utils';

interface FarmerHousePanelProps {
  landId: bigint;
  farmerHouseLevel: number;
  onQuestUpdate: () => void;
}

// Rewards wallet that funds farmer quests
const QUEST_REWARDS_WALLET = '0xd528071FB9dC9715ea8da44e2c4433EAc017d1DB' as const;
const MIN_SEED_BALANCE = parseUnits('300', 18); 

export default function FarmerHousePanel({ landId, farmerHouseLevel, onQuestUpdate }: FarmerHousePanelProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [slots, setSlots] = React.useState<import('@/lib/contracts').QuestSlot[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);
  const [currentBlock, setCurrentBlock] = React.useState<bigint>(BigInt(0));
  const [difficulty, setDifficulty] = React.useState<Record<number, number>>({});
  const [rewardsWalletBalance, setRewardsWalletBalance] = React.useState<bigint>(BigInt(0));
  const [balanceLoading, setBalanceLoading] = React.useState<boolean>(false);

  const fetchRewardsBalance = React.useCallback(async () => {
    if (!publicClient) return;
    setBalanceLoading(true);
    try {
      const balance = await publicClient.readContract({
        address: PIXOTCHI_TOKEN_ADDRESS,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [QUEST_REWARDS_WALLET as `0x${string}`],
      }) as bigint;
      setRewardsWalletBalance(balance);
    } catch (e: any) {
      console.error('Failed to fetch rewards wallet balance:', e);
    } finally {
      setBalanceLoading(false);
    }
  }, [publicClient]);

  const fetchSlots = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getQuestSlotsByLandId(landId);
      setSlots(data);
    } catch (e: any) {
      setError('Failed to load quests');
    } finally {
      setLoading(false);
    }
  }, [landId]);

  React.useEffect(() => {
    fetchSlots();
    fetchRewardsBalance();
    // Refresh balance every 30 seconds to stay up-to-date
    const interval = setInterval(fetchRewardsBalance, 30000);
    return () => clearInterval(interval);
  }, [fetchSlots, fetchRewardsBalance]);

  // Initialize and watch the current block number immediately to avoid transient wrong UI
  const { data: liveBlock } = useBlockNumber({ watch: true, query: { refetchInterval: 1000 } });
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
  const difficultyLabel = (d: number) => (d === 0 ? 'EASY' : d === 1 ? 'MEDIUM' : 'HARD');

  const handleSuccess = async (opts?: { slotIndex?: number; awaitCommitted?: boolean; awaitUncommitted?: boolean }) => {
    await fetchSlots();
    onQuestUpdate();
    // Ensure building/land UI reflects changes immediately
    try { window.dispatchEvent(new Event('buildings:refresh')); } catch {}

    // Optional: poll for desired status transition using fresh reads (avoids stale state)
    if (opts && typeof opts.slotIndex === 'number' && (opts.awaitCommitted || opts.awaitUncommitted)) {
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const fresh = await getQuestSlotsByLandId(landId);
          const s = fresh?.[opts.slotIndex];
          const st = s ? statusOf(s) : undefined;
          if (opts.awaitCommitted && st === 'Committed') break;
          if (opts.awaitUncommitted && st !== 'Committed') break;
        } catch {}
      }
      await fetchSlots();
    }
  }

  const isRewardsDepleted = rewardsWalletBalance < MIN_SEED_BALANCE;

  return (
    <div className="space-y-3 pt-2">
      <h4 className="font-semibold text-sm text-center">Quests</h4>
      {loading ? (
        <div className="text-center text-muted-foreground text-sm">Loading…</div>
      ) : error ? (
        <div className="text-center text-destructive text-sm">{error}</div>
      ) : (
        <>
          {isRewardsDepleted && (
            <div className="rounded-md border border-amber-300 bg-amber-100/60 px-3 py-2 text-xs text-amber-900">
              Farmer House rewards wallet is being refilled. Starting new quests is paused to prevent failed transactions,
              but you can still finish any farmers who are already out on quests.
            </div>
          )}
          <div className="grid grid-cols-1 gap-2">
          {slots.slice(0, Math.min(farmerHouseLevel ?? 3, 3)).map((s, idx) => (
            <div key={idx} className="flex flex-col gap-2 rounded-md border bg-card p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <div className="font-medium">Slot {idx + 1}</div>
                  <div className="text-xs text-muted-foreground">{statusOf(s)}</div>
                </div>
                <div className="flex items-center gap-2">
                  {statusOf(s) === 'Loading' && (
                    <div className="text-xs text-muted-foreground px-2 py-1 rounded bg-muted">Loading…</div>
                  )}
                  {statusOf(s) === 'Ready to commit' && (
                    <SponsoredTransaction
                      calls={[{ address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'questCommit', args: [landId, BigInt(idx)] }]}
                      buttonText="Return now"
                      buttonClassName="h-8 px-3 text-xs"
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
                      buttonClassName="h-8 px-3 text-xs"
                      hideStatus
                      onSuccess={() => { toast.success('Loot bag opened!'); handleSuccess({ slotIndex: idx, awaitUncommitted: true }); }}
                    />
                  </div>
                  )}
                  {statusOf(s) === 'Cooldown' && (
                    <div className="text-xs text-muted-foreground px-2 py-1 rounded bg-muted">
                      ~{formatSeconds(blocksLeft(s.coolDownBlock) * 2)} left
                    </div>
                  )}
                </div>
              </div>
              {statusOf(s) === 'Available' && (
                <>
                  <div className="grid gap-2 sm:grid-cols-[1fr,auto] items-center rounded-md border bg-background/50 p-2">
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
                          val === '0' ? (selected ? 'bg-green-600/20 text-green-700' : 'text-green-700') :
                          val === '1' ? (selected ? 'bg-amber-600/20 text-amber-700' : 'text-amber-700') :
                          (selected ? 'bg-red-600/20 text-red-700' : 'text-red-700')
                        )}
                      />
                    </div>
                    <SponsoredTransaction
                      calls={[{ address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'questStart', args: [landId, BigInt(difficulty[idx] ?? 0), BigInt(idx)] }]}
                      buttonText="Start"
                      buttonClassName="h-8 px-3 text-xs w-full sm:w-auto shrink-0"
                      hideStatus
                      disabled={isRewardsDepleted}
                      onSuccess={(tx: any) => {
                        handleSuccess();
                        try {
                          const payload: Record<string, unknown> = { address, taskId: 's3_send_quest' };
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
                    />
                  </div>
                  {isRewardsDepleted && (
                    <p className="text-xs text-amber-800 sm:col-span-2">
                      Rewards pool is low—please wait for it to refill before sending new quests.
                    </p>
                  )}
                </>
              )}
              {statusOf(s) === 'In progress' && (
                <div className="space-y-1">
                  <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-2 bg-primary transition-all" style={{ width: `${Math.min(100, progressPct(s)).toFixed(1)}%` }} />
                  </div>
                  <div className="text-xs text-muted-foreground">Ends in ~{formatSeconds(Math.max(0, Math.ceil(blocksLeft(s.endBlock) * 2)))}</div>
                </div>
              )}
            </div>
          ))}
          {slots.length === 0 && (
            <div className="text-center text-sm text-muted-foreground">No quest slots available.</div>
          )}
          </div>
        </>
      )}
    </div>
  );
}
