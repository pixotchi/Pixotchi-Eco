"use client";

import { useCallback, useEffect, useState } from 'react';
import { parseLastSwapTransaction, type LastSwapTransaction } from '@/lib/swap/review';

/** Retain one public receipt reference per wallet; never persist form amounts. */
export function useLastSwapTransaction(address: string | undefined) {
  const owner = address?.toLowerCase();
  const storageKey = owner ? `pixotchi:last-swap:${owner}` : null;
  const [stored, setStored] = useState<LastSwapTransaction | null>(null);
  useEffect(() => {
    try { setStored(storageKey ? parseLastSwapTransaction(window.localStorage.getItem(storageKey), owner) : null); }
    catch { setStored(null); }
  }, [owner, storageKey]);
  const remember = useCallback((hash: string | undefined, action: LastSwapTransaction['action']) => {
    if (!owner || !storageKey || !hash) return;
    const serialized = JSON.stringify({ owner, hash, action, confirmedAt: Date.now() });
    const record = parseLastSwapTransaction(serialized, owner);
    if (!record) return;
    setStored(record);
    try { window.localStorage.setItem(storageKey, serialized); } catch { /* The mounted receipt remains available. */ }
  }, [owner, storageKey]);
  return { lastTransaction: stored?.owner === owner ? stored : null, remember };
}
