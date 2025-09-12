"use client";

import React from 'react';
import { useAccount } from 'wagmi';
import { useWatchBlockNumber } from 'wagmi';
import { getQuestSlotsByLandId, LAND_CONTRACT_ADDRESS } from '@/lib/contracts';
import SponsoredTransaction from '@/components/transactions/sponsored-transaction';
import { landAbi } from '@/public/abi/pixotchi-v3-abi';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { toast } from 'react-hot-toast';

interface FarmerHousePanelProps {
  landId: bigint;
  farmerHouseLevel: number;
  onQuestUpdate: () => void;
}

export default function FarmerHousePanel({ landId, farmerHouseLevel, onQuestUpdate }: FarmerHousePanelProps) {
  const { address } = useAccount();
  const [slots, setSlots] = React.useState<import('@/lib/contracts').QuestSlot[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);
  const [currentBlock, setCurrentBlock] = React.useState<bigint>(BigInt(0));
  const [difficulty, setDifficulty] = React.useState<Record<number, number>>({});

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
  }, [fetchSlots]);

  useWatchBlockNumber({ onBlockNumber: (bn) => setCurrentBlock(bn), pollingInterval: 3000 });

  const statusOf = (s: import('@/lib/contracts').QuestSlot): string => {
    const now = currentBlock;
    if (s.coolDownBlock !== BigInt(0) && now < s.coolDownBlock) return 'Cooldown';
    if (s.startBlock === BigInt(0)) return 'Available';
    if (now <= s.endBlock) return 'In progress';
    if (s.pseudoRndBlock === BigInt(0)) return 'Ready to commit';
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

  const handleSuccess = async (slotIndex?: number, waitForFinalize?: boolean) => {
    await fetchSlots();
    onQuestUpdate();
    // Ensure building/land UI reflects changes immediately
    try { window.dispatchEvent(new Event('buildings:refresh')); } catch {}

    // After opening loot bag, the UI can briefly show stale status. Poll briefly until it flips from 'Committed'.
    if (waitForFinalize && typeof slotIndex === 'number') {
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 500));
        await fetchSlots();
        // Nudge progress calculation by faking a minor block advance if needed
        // (statusOf uses currentBlock which updates every 3s; this helps visually)
        // setCurrentBlock((b) => (b > 0n ? b + 1n : b));
        try {
          const s = (slots || [])[slotIndex];
          if (!s || statusOf(s) !== 'Committed') break;
        } catch {}
      }
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
        <div className="grid grid-cols-1 gap-2">
          {slots.slice(0, Math.min(farmerHouseLevel ?? 3, 3)).map((s, idx) => (
            <div key={idx} className="flex flex-col gap-2 rounded-md border bg-card p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <div className="font-medium">Slot {idx + 1}</div>
                  <div className="text-xs text-muted-foreground">{statusOf(s)}</div>
                </div>
                <div className="flex items-center gap-2">
                  {statusOf(s) === 'Ready to commit' && (
                    <SponsoredTransaction
                      calls={[{ address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'questCommit', args: [landId, BigInt(idx)] }]}
                      buttonText="Return now"
                      buttonClassName="h-8 px-3 text-xs"
                      hideStatus
                      onSuccess={handleSuccess}
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
                      onSuccess={() => { toast.success('Loot bag opened!'); handleSuccess(idx, true); }}
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
                <div className="grid gap-2 sm:grid-cols-[1fr,auto] items-center rounded-md border bg-background/50 p-2">
                  <div className="overflow-x-auto sm:overflow-visible">
                    <ToggleGroup
                      value={String(difficulty[idx] ?? 0)}
                      onValueChange={(v) => setDifficulty((prev) => ({ ...prev, [idx]: Number(v || 0) }))}
                      options={[
                        { value: '0', label: <span>Easy <span className="text-[11px] text-muted-foreground">(3h)</span></span> },
                        { value: '1', label: <span>Med <span className="text-[11px] text-muted-foreground">(6h)</span></span> },
                        { value: '2', label: <span>Hard <span className="text-[11px] text-muted-foreground">(12h)</span></span> },
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
                    onSuccess={() => { handleSuccess(); try { fetch('/api/gamification/missions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, taskId: 's3_send_quest' }) }); } catch {} }}
                  />
                </div>
              )}
              {statusOf(s) === 'In progress' && (
                <div className="space-y-1">
                  <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-2 bg-primary transition-all" style={{ width: `${Math.min(100, progressPct(s)).toFixed(1)}%` }} />
                  </div>
                  <div className="text-[11px] text-muted-foreground">Ends in ~{formatSeconds(Math.max(0, Math.ceil(blocksLeft(s.endBlock) * 2)))}</div>
                </div>
              )}
            </div>
          ))}
          {slots.length === 0 && (
            <div className="text-center text-sm text-muted-foreground">No quest slots available.</div>
          )}
        </div>
      )}
    </div>
  );
}
