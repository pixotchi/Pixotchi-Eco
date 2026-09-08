"use client";

import { useEffect, useRef, useState } from 'react';
import type { LifecycleStatus } from '@/components/transactions/transaction-kit';

type ApprovalAttempt = { scope: string; action: string; token: `0x${string}`; label: string; settled: boolean };

/** Keep the approval's token/controller stable until its wallet/receipt attempt settles. */
export function useBuildingApproval(scope: string) {
  const [attempt, setAttempt] = useState<ApprovalAttempt | null>(null);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const active = attempt?.scope === scope ? attempt : null;
  useEffect(() => {
    if (!active?.settled) return;
    const timer = setTimeout(() => setAttempt(previous => previous === active ? null : previous), 5000);
    return () => clearTimeout(timer);
  }, [active]);
  const observe = (action: string, token: `0x${string}`, label: string) => (status: LifecycleStatus) => {
    if (currentScope.current !== scope) return;
    const completed = ['success', 'reverted', 'cancelled', 'canceled'].includes(status.statusName);
    const pending = ['buildingTransaction', 'transactionPending', 'confirmedSyncing', 'submissionAmbiguous', 'transactionUnresolved', 'transactionStale', 'success'].includes(status.statusName)
      || (!completed && !!(status.statusData?.transactionHash || status.statusData?.transactionId));
    const settled = status.statusName === 'success';
    setAttempt(previous => pending
      ? previous?.scope === scope && previous.action === action && previous.settled === settled ? previous : { scope, action, token, label, settled }
      : previous?.scope === scope && previous.action === action ? null : previous);
  };
  return { active, observe };
}
