"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import type { BroadcastMessage } from '@/lib/broadcast-service';
import { useFrameContext } from '@/lib/frame-context';

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
  const frameContext = useFrameContext();
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
    const fid =
      typeof frameContext?.context === 'object'
        ? (frameContext.context as any)?.user?.fid
        : undefined;

    if (address) return `addr:${address.toLowerCase()}`;
    if (authenticated && user?.id) return `privy:${user.id}`;
    if (typeof fid === 'number' && fid > 0) return `fid:${fid}`;
    return undefined;
  }, [address, authenticated, user?.id, frameContext?.context]);

  // Local dismissed IDs are loaded synchronously in state initializer

  // Check tutorial completion status on mount only
  useEffect(() => {
    setTutorialCompleted(isTutorialCompleted());
    
    // Listen for tutorial completion event if needed
    const handleTutorialComplete = () => {
      console.log('[Broadcast] Tutorial completed, will fetch messages on next poll');
      setTutorialCompleted(true);
    };
    
    window.addEventListener('tutorial:complete', handleTutorialComplete);
    
    return () => {
      window.removeEventListener('tutorial:complete', handleTutorialComplete);
    };
  }, []);

  // Track mounted state to prevent state updates after unmount
  const mountedRef = useRef(true);
  
  // Fetch active messages - relaxed to not require wallet connection
  const fetchMessages = useCallback(async () => {
    // Guard against calls after unmount
    if (!mountedRef.current) return;
    
    // Require tutorial completion only; wallet connection is optional
    if (!isTutorialCompleted()) {
      // Ensure we clear any messages if tutorial isn't completed
      if (mountedRef.current) {
        setMessages(prev => (prev.length > 0 ? [] : prev));
        setLoading(false);
      }
      return;
    }

    // Prevent excessive polling - minimum 10 seconds between fetches
    const now = Date.now();
    if (now - lastFetchRef.current < 10000) {
      console.log(`[Broadcast] Skipping fetch - only ${((now - lastFetchRef.current) / 1000).toFixed(1)}s since last fetch`);
      return;
    }
    lastFetchRef.current = now;
    fetchCountRef.current += 1;

    try {
      const url = identity ? `/api/broadcast/active?address=${encodeURIComponent(identity)}` : '/api/broadcast/active';

      const response = await fetch(url);
      
      // Check if component is still mounted before processing response
      if (!mountedRef.current) return;
      
      const data = await response.json();
      
      // Check again after async operation
      if (!mountedRef.current) return;
      
      if (data.success && Array.isArray(data.messages)) {
        // Filter out locally dismissed messages (persisted between sessions)
        const activeMessages = data.messages.filter(
          (msg: BroadcastMessage) => !localDismissedIds.has(msg.id)
        );
        
        setMessages(activeMessages);
      }
    } catch (error) {
      console.error('[Broadcast] Failed to fetch messages:', error);
    } finally {
      // Only update loading state if component is still mounted
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [address, isConnected, localDismissedIds, identity]);

  // Dismiss a message
  const dismissMessage = useCallback(async (messageId: string) => {
    // Optimistically remove from UI
    setMessages(prev => prev.filter(msg => msg.id !== messageId));
    
    // Track dismissal locally
    const newDismissed = new Set(localDismissedIds);
    newDismissed.add(messageId);
    setLocalDismissedIds(newDismissed);
    
    // Persist to localStorage (persists across sessions)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...newDismissed]));
    } catch (error) {
      console.warn('Failed to save dismissed broadcasts:', error);
    }
    
    // Send dismissal to server (only when connected)
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
      // Silent fail - tracking shouldn't break UX
      console.debug('Failed to track impression:', error);
    }
  }, []);

  // Initial fetch and setup polling - run once on mount
  useEffect(() => {
    mountedRef.current = true;
    // Initial fetch
    fetchMessages();

    // Set up polling interval (only once)
    pollingIntervalRef.current = setInterval(() => {
      if (mountedRef.current) {
        fetchMessages();
      }
    }, POLL_INTERVAL);

    // Cleanup on unmount
    return () => {
      mountedRef.current = false;
      console.log('[Broadcast] Cleaning up polling system');
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run once

  // Refresh when wallet connects/disconnects (but don't restart polling)
  useEffect(() => {
    if (!mountedRef.current) return;
    
    if (address !== undefined || (authenticated && user?.id)) {
      console.log('[Broadcast] Wallet address changed, fetching messages');
      fetchMessages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, authenticated, user?.id]); // Identity-related triggers

  return {
    messages,
    loading,
    dismissMessage,
    trackImpression,
    refresh: fetchMessages,
  };
}

