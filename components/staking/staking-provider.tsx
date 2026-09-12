"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRetryableDialog } from '@/components/retryable-dialog';
import { onStakingDialogOpen } from '@/lib/app-events';

const StakingDialog = createRetryableDialog(() => import('./staking-dialog'), 'Stake SEED');
const StakingContext = createContext<{ open: boolean; openDialog: () => void } | null>(null);

/** One owner survives header placement, navigation and viewport changes. */
export function StakingProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const openDialog = useCallback(() => { setLoaded(true); setOpen(true); }, []);
  useEffect(() => onStakingDialogOpen(openDialog), [openDialog]);
  const value = useMemo(() => ({ open, openDialog }), [open, openDialog]);
  return (
    <StakingContext.Provider value={value}>
      {children}
      {loaded && <StakingDialog open={open} onOpenChange={setOpen} />}
    </StakingContext.Provider>
  );
}

export function useStakingDialog() {
  const context = useContext(StakingContext);
  if (!context) throw new Error('useStakingDialog requires StakingProvider');
  return context;
}
