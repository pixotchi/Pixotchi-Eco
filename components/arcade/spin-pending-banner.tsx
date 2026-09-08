"use client";

import { useEffect, useState } from 'react';
import { useAccount, useBlockNumber } from 'wagmi';
import { Button } from '@/components/ui/button';
import { getSpinRevealState } from '@/lib/spin-reveal-state';
import { readStoredSpinPending, SPIN_PENDING_CHANGED_EVENT, type StoredSpinPending } from '@/lib/spin-pending-storage';

export function SpinPendingBanner({ plantId, onResume }: { plantId: number; onResume: () => void }) {
  const { address } = useAccount();
  return <ScopedSpinPendingBanner key={`${address?.toLowerCase() ?? ''}:${plantId}`} address={address} plantId={plantId} onResume={onResume} />;
}

function ScopedSpinPendingBanner({ address, plantId, onResume }: { address: string | undefined; plantId: number; onResume: () => void }) {
  const [pending, setPending] = useState<StoredSpinPending | null>(null);
  useEffect(() => {
    const sync = () => {
      let next: StoredSpinPending | null = null;
      try { if (address) next = readStoredSpinPending(window.localStorage, address, plantId); } catch { }
      if (!next?.commitBlock) next = null;
      setPending(current => current?.commitment === next?.commitment && current?.commitBlock === next?.commitBlock ? current : next);
    };
    sync();
    window.addEventListener(SPIN_PENDING_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener(SPIN_PENDING_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', sync);
    };
  }, [address, plantId]);
  const { data: block, isError, refetch } = useBlockNumber({
    watch: Boolean(pending),
    query: { enabled: Boolean(pending), refetchInterval: pending ? 3000 : false },
  });
  if (!pending) return null;
  const reveal = getSpinRevealState(pending.commitBlock, isError || block === undefined ? null : Number(block));
  return (
    <div className="mt-3 space-y-2 rounded-[var(--radius-panel)] border border-warning/40 bg-warning/10 p-3 text-sm" role="status">
      <p className="font-medium">{reveal.status === 'expired' ? 'SpinLeaf reveal window ended' : 'SpinLeaf round needs your reveal'}</p>
      <p>Plant #{plantId}. {reveal.status === 'expired' ? 'Open Arcade to check the outcome. Unrevealed rounds forfeit their stars.' : reveal.blocksUntilExpiry === null ? 'Checking the remaining blocks. Reveal on this device before the window ends to avoid forfeiting the stars.' : `Reveal within ${reveal.blocksUntilExpiry} blocks or the stars are forfeited.`}</p>
      <Button variant="outline" size="compact" onClick={onResume}>Open SpinLeaf round</Button>
      {isError && <Button variant="link" size="compact" onClick={() => void refetch()}>Retry block check</Button>}
    </div>
  );
}
