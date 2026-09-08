'use client';

import { useCallback, useEffect, useRef } from 'react';
import { allowWalletReconnect, isAuthCleanupPending, needsFreshWalletDocument } from '@/lib/auth-cleanup';
import { reloadWalletSession } from '@/lib/auth-session-reload';

export function useMiniAppReconnect<C extends { id: string; name: string }>({ connectors, connect, onPending, onError }: {
  connectors: readonly C[];
  connect: (connector: C) => Promise<unknown>;
  onPending: (pending: boolean) => void;
  onError: (message: string | null) => void;
}) {
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return useCallback(async () => {
    if (inFlight.current || isAuthCleanupPending()) return;
    inFlight.current = true;
    onPending(true);
    onError(null);
    try {
      if (needsFreshWalletDocument()) {
        await reloadWalletSession(true);
        return;
      }
      const connector = connectors.find((candidate) => `${candidate.id} ${candidate.name}`.toLowerCase().includes('farcaster')) ?? connectors[0];
      if (!connector) throw new Error('No wallet is available. Reopen the game from Farcaster or use your browser.');
      if (!allowWalletReconnect()) return;
      await connect(connector);
    } catch (cause) {
      if (mounted.current) onError(cause instanceof Error ? cause.message : 'Could not connect. Please try again.');
    } finally {
      inFlight.current = false;
      if (mounted.current) onPending(false);
    }
  }, [connect, connectors, onError, onPending]);
}
