"use client";

import { useAuthSurface } from '@/hooks/useAuthSurface';
import type { BroadcastMessage } from '@/lib/broadcast-service';
import { useFrameContext } from '@/lib/frame-context';
import { usePrivy } from '@privy-io/react-auth';
import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { useAccount } from 'wagmi';

const POLL_INTERVAL = 90000; // 90 seconds
const MIN_FETCH_INTERVAL = 10000;
const STORAGE_KEY = 'pixotchi:dismissed-broadcasts';
const TUTORIAL_STORAGE_KEY = 'pixotchi:tutorial';

type BroadcastSnapshot = {
  identityKey: string;
  loading: boolean;
  messages: BroadcastMessage[];
};

type FetchBroadcastOptions = {
  force?: boolean;
};

// Helper to check if tutorial is completed
function isTutorialCompleted(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const stored = localStorage.getItem(TUTORIAL_STORAGE_KEY);
    if (!stored) return false;
    const data = JSON.parse(stored);
    return data.completed === true;
  } catch {
    return false;
  }
}

export function useBroadcastMessages() {
  const { address, isConnected } = useAccount();
  const { user, authenticated, ready } = usePrivy();
  const frameContext = useFrameContext();
  const { surface: authSurface } = useAuthSurface();

  // Build a cross-session identity for server-side dismissal when wallet is unavailable.
  const identity = useMemo(() => {
    const fid =
      typeof frameContext?.context === 'object'
        ? (frameContext.context as UntypedValue)?.user?.fid
        : undefined;

    if (address) return `addr:${address.toLowerCase()}`;
    if ((authSurface === 'privy' || authSurface === 'privysolana') && ready && authenticated && user?.id) {
      return `privy:${user.id}`;
    }
    if (typeof fid === 'number' && fid > 0) return `fid:${fid}`;
    return undefined;
  }, [address, authSurface, authenticated, ready, user?.id, frameContext?.context]);
  const identityKey = identity ?? 'public';

  const [localDismissedIds, setLocalDismissedIds] = useState<Set<string>>(() => {
    try {
      if (typeof window === 'undefined') return new Set();
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return new Set(parsed);
      }
    } catch (error) {
      console.warn('Failed to load dismissed broadcasts:', error);
    }
    return new Set();
  });
  const [snapshot, setSnapshot] = useState<BroadcastSnapshot>(() => ({
    identityKey,
    loading: true,
    messages: [],
  }));
  const currentSnapshot = useMemo(
    () => snapshot.identityKey === identityKey
      ? snapshot
      : { identityKey, loading: true, messages: [] },
    [identityKey, snapshot],
  );

  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const identityKeyRef = useRef(identityKey);
  const lastFetchByIdentityRef = useRef(new Map<string, number>());
  const localDismissedIdsRef = useRef(localDismissedIds);
  const mountedRef = useRef(true);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const requestGenerationRef = useRef(0);
  identityKeyRef.current = identityKey;
  localDismissedIdsRef.current = localDismissedIds;

  // Local dismissed IDs are loaded synchronously in state initializer

  // Tutorial completion is read directly (isTutorialCompleted) where it
  // gates fetching. The old write-only state here ran a localStorage read +
  // JSON.parse via a NON-lazy useState initializer on every single render of
  // the app shell, and its setters triggered renders nothing observed.

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      activeRequestControllerRef.current?.abort();
      activeRequestControllerRef.current = null;
    };
  }, []);

  // Fetch active messages. Every request owns an immutable identity and
  // generation; a retained callback from a previous wallet cannot cancel or
  // commit over the current identity's request.
  const fetchMessages = useCallback(async (options: FetchBroadcastOptions = {}) => {
    const requestedIdentity = identity;
    const requestedIdentityKey = identityKey;
    if (!mountedRef.current || identityKeyRef.current !== requestedIdentityKey) return;
    
    // Require tutorial completion only; wallet connection is optional
    if (!isTutorialCompleted()) {
      requestGenerationRef.current += 1;
      activeRequestControllerRef.current?.abort();
      activeRequestControllerRef.current = null;
      setSnapshot({ identityKey: requestedIdentityKey, loading: false, messages: [] });
      return;
    }

    // Prevent excessive polling per identity. Identity changes and explicit
    // refreshes use force so a recent request for account A cannot suppress B.
    const now = Date.now();
    const lastFetch = lastFetchByIdentityRef.current.get(requestedIdentityKey) ?? 0;
    if (!options.force && now - lastFetch < MIN_FETCH_INTERVAL) {
      if (process.env.NODE_ENV === 'development') {
        console.debug(`[Broadcast] Skipping ${requestedIdentityKey} fetch - only ${((now - lastFetch) / 1000).toFixed(1)}s since last fetch`);
      }
      return;
    }
    lastFetchByIdentityRef.current.set(requestedIdentityKey, now);
    if (lastFetchByIdentityRef.current.size > 20) {
      const oldestIdentity = lastFetchByIdentityRef.current.keys().next().value as string | undefined;
      if (oldestIdentity) lastFetchByIdentityRef.current.delete(oldestIdentity);
    }

    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    activeRequestControllerRef.current?.abort();
    const controller = new AbortController();
    activeRequestControllerRef.current = controller;
    setSnapshot((previous) => ({
      identityKey: requestedIdentityKey,
      loading: true,
      messages: previous.identityKey === requestedIdentityKey ? previous.messages : [],
    }));

    const isCurrentRequest = () =>
      mountedRef.current
      && !controller.signal.aborted
      && requestGenerationRef.current === generation
      && identityKeyRef.current === requestedIdentityKey
      && activeRequestControllerRef.current === controller;

    try {
      const url = requestedIdentity
        ? `/api/broadcast/active?address=${encodeURIComponent(requestedIdentity)}`
        : '/api/broadcast/active';

      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Broadcast request failed (${response.status})`);
      const data = await response.json();
      if (!isCurrentRequest()) return;

      if (data.success && Array.isArray(data.messages)) {
        const activeMessages = data.messages.filter(
          (msg: BroadcastMessage) => !localDismissedIdsRef.current.has(msg.id),
        );

        setSnapshot({
          identityKey: requestedIdentityKey,
          loading: false,
          messages: activeMessages,
        });
      }
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        console.error('[Broadcast] Failed to fetch messages:', error);
      }
    } finally {
      if (isCurrentRequest()) {
        activeRequestControllerRef.current = null;
        setSnapshot((previous) => previous.identityKey === requestedIdentityKey
          ? { ...previous, loading: false }
          : previous);
      }
    }
  }, [identity, identityKey]);

  const fetchMessagesRef = useRef(fetchMessages);

  useEffect(() => {
    fetchMessagesRef.current = fetchMessages;
  }, [fetchMessages]);

  // Clear synchronously for the committed identity and bypass its throttle. The
  // render-time snapshot gate above also prevents a one-frame previous-owner flash
  // before this effect runs.
  useEffect(() => {
    requestGenerationRef.current += 1;
    activeRequestControllerRef.current?.abort();
    activeRequestControllerRef.current = null;
    setSnapshot({ identityKey, loading: true, messages: [] });
    void fetchMessagesRef.current({ force: true });

    return () => {
      requestGenerationRef.current += 1;
      activeRequestControllerRef.current?.abort();
      activeRequestControllerRef.current = null;
    };
  }, [identityKey]);

  // Dismiss a message
  const dismissMessage = useCallback(async (messageId: string) => {
    const requestedIdentity = identity;
    const requestedIdentityKey = identityKey;
    if (!mountedRef.current || identityKeyRef.current !== requestedIdentityKey) return;

    // Optimistically remove from UI
    setSnapshot((previous) => previous.identityKey === requestedIdentityKey
      ? { ...previous, messages: previous.messages.filter((message) => message.id !== messageId) }
      : previous);
    
    // Track dismissal locally
    const newDismissed = new Set(localDismissedIdsRef.current);
    newDismissed.add(messageId);
    localDismissedIdsRef.current = newDismissed;
    setLocalDismissedIds(newDismissed);
    
    // Persist to localStorage (persists across sessions)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...newDismissed]));
    } catch (error) {
      console.warn('Failed to save dismissed broadcasts:', error);
    }
    
    // Send dismissal to server (only when connected)
    if (requestedIdentity && (isConnected || ((authSurface === 'privy' || authSurface === 'privysolana') && ready && authenticated))) {
      try {
        await fetch('/api/broadcast/dismiss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId, address: requestedIdentity }),
        });
      } catch (error) {
        console.error('Failed to record dismissal:', error);
      }
    }
  }, [authSurface, identity, identityKey, isConnected, authenticated, ready]);

  // Track impression (message was shown)
  const trackImpression = useCallback(async (messageId: string) => {
    try {
      await fetch('/api/broadcast/impression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
      });
    } catch (error) {
      // Silent fail - tracking shouldn't break UX
      if (process.env.NODE_ENV === 'development') {
        console.debug('Failed to track impression:', error);
      }
    }
  }, []);

  // Set up polling once; the ref always points at the current identity loader.
  useEffect(() => {
    // Set up polling interval (only once).
    // Skip ticks while the tab is hidden — this fired every 90s regardless,
    // costing ~40 requests/hour per backgrounded session. The chat polls already
    // gate on visibilityState the same way.
    pollingIntervalRef.current = setInterval(() => {
      if (mountedRef.current && document.visibilityState === 'visible') {
        fetchMessagesRef.current();
      }
    }, POLL_INTERVAL);

    // Catch up as soon as the tab comes back. fetchMessages already enforces its
    // own 10s floor, so this cannot turn tab-switching into a request storm.
    const handleVisibility = () => {
      if (mountedRef.current && document.visibilityState === 'visible') {
        fetchMessagesRef.current();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Cleanup on unmount
    return () => {
      if (process.env.NODE_ENV === 'development') {
        console.debug('[Broadcast] Cleaning up polling system');
      }
      document.removeEventListener('visibilitychange', handleVisibility);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []); // Empty deps - only run once

  const refreshMessages = useCallback(
    () => fetchMessages({ force: true }),
    [fetchMessages],
  );

  return {
    messages: currentSnapshot.messages,
    loading: currentSnapshot.loading,
    dismissMessage,
    trackImpression,
    refresh: refreshMessages,
  };
}
