"use client";

import { useEffect, useState, useCallback, useRef, useMemo, useEffectEvent } from 'react';
import { useAccount } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import type { BroadcastMessage } from '@/lib/broadcast-service';

const POLL_INTERVAL = 30000; // 30 seconds
const STORAGE_KEY = 'pixotchi:dismissed-broadcasts';
const TUTORIAL_STORAGE_KEY = 'pixotchi:tutorial';

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
  const { user, authenticated } = usePrivy();
  const [messages, setMessages] = useState<BroadcastMessage[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [tutorialCompleted, setTutorialCompleted] = useState(isTutorialCompleted());
  const lastFetchRef = useRef<number>(0);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fetchCountRef = useRef<number>(0);

  // Build a cross-session identity for server-side dismissal when wallet is unavailable
  const identity = useMemo(() => {
    if (address) return `addr:${address.toLowerCase()}`;
    if (authenticated && user?.id) return `privy:${user.id}`;
    try {
      const fid = (window as any)?.__pixotchi_frame_context__?.context?.user?.fid;
      if (typeof fid === 'number' && fid > 0) return `fid:${fid}`;
    } catch {}
    return undefined;
  }, [address, authenticated, user?.id]);

  // Fetch active messages - relaxed to not require wallet connection
  const fetchMessages = useCallback(async () => {
    if (!isTutorialCompleted()) {
      setMessages(prev => (prev.length > 0 ? [] : prev));
      setLoading(false);
      return;
    }

    const now = Date.now();
    if (now - lastFetchRef.current < 10000) {
      console.log(`[Broadcast] Skipping fetch - only ${((now - lastFetchRef.current) / 1000).toFixed(1)}s since last fetch`);
      return;
    }
    lastFetchRef.current = now;
    fetchCountRef.current += 1;

    console.log(`[Broadcast] Fetching messages (count: ${fetchCountRef.current})`);

    try {
      const url = identity ? `/api/broadcast/active?address=${encodeURIComponent(identity)}` : '/api/broadcast/active';

      const response = await fetch(url);
      const data = await response.json();
      
      if (data.success && Array.isArray(data.messages)) {
        const activeMessages = data.messages.filter(
          (msg: BroadcastMessage) => !localDismissedIds.has(msg.id)
        );
        
        setMessages(activeMessages);
        console.log(`[Broadcast] Found ${activeMessages.length} active messages`);
      }
    } catch (error) {
      console.error('[Broadcast] Failed to fetch messages:', error);
    } finally {
      setLoading(false);
    }
  }, [identity, localDismissedIds]);

  // ✅ useEffectEvent: Handles tutorial completion without triggering effect re-runs
  const handleTutorialComplete = useEffectEvent(() => {
    console.log('[Broadcast] Tutorial completed, will fetch messages on next poll');
    setTutorialCompleted(true);
    // Don't call fetchMessages here - let the polling interval handle it
  });

  // ✅ useEffectEvent: Setup polling (always sees latest fetchMessages without re-running effect)
  const setupPolling = useEffectEvent(() => {
    console.log('[Broadcast] Initializing polling system');
    
    fetchMessages();

    pollingIntervalRef.current = setInterval(() => {
      console.log('[Broadcast] Polling interval triggered');
      fetchMessages();
    }, POLL_INTERVAL);

    return () => {
      console.log('[Broadcast] Cleaning up polling system');
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  });

  // ✅ useEffectEvent: Refresh on wallet/identity change without affecting polling
  const refreshOnIdentityChange = useEffectEvent(() => {
    console.log('[Broadcast] Wallet address changed, fetching messages');
    fetchMessages();
  });

  // Initialize event listeners on mount
  useEffect(() => {
    setTutorialCompleted(isTutorialCompleted());
    window.addEventListener('tutorial:complete', handleTutorialComplete);
    return () => {
      window.removeEventListener('tutorial:complete', handleTutorialComplete);
    };
  }, [handleTutorialComplete]);

  // Setup polling once on mount
  useEffect(() => {
    const cleanup = setupPolling();
    return cleanup;
  }, [setupPolling]);

  // Refresh when identity changes - uses useEffectEvent so polling isn't restarted
  useEffect(() => {
    if (address !== undefined || (authenticated && user?.id)) {
      refreshOnIdentityChange();
    }
  }, [address, authenticated, user?.id, refreshOnIdentityChange]);

  // Dismiss a message
  const dismissMessage = useCallback(async (messageId: string) => {
    setMessages(prev => prev.filter(msg => msg.id !== messageId));
    
    const newDismissed = new Set(localDismissedIds);
    newDismissed.add(messageId);
    setLocalDismissedIds(newDismissed);
    
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...newDismissed]));
    } catch (error) {
      console.warn('Failed to save dismissed broadcasts:', error);
    }
    
    if (identity && (isConnected || authenticated)) {
      try {
        await fetch('/api/broadcast/dismiss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId, address: identity }),
        });
      } catch (error) {
        console.error('Failed to record dismissal:', error);
      }
    }
  }, [identity, isConnected, authenticated, localDismissedIds]);

  // Track impression (message was shown)
  const trackImpression = useCallback(async (messageId: string) => {
    try {
      await fetch('/api/broadcast/impression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
      });
    } catch (error) {
      console.debug('Failed to track impression:', error);
    }
  }, []);

  return {
    messages,
    loading,
    dismissMessage,
    trackImpression,
    refresh: fetchMessages,
  };
}

