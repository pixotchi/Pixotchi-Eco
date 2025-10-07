"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAccount } from 'wagmi';
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
  const { address } = useAccount();
  const [messages, setMessages] = useState<BroadcastMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [localDismissedIds, setLocalDismissedIds] = useState<Set<string>>(new Set());
  const [tutorialCompleted, setTutorialCompleted] = useState(isTutorialCompleted());
  const lastFetchRef = useRef<number>(0);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fetchCountRef = useRef<number>(0);

  // Load dismissed IDs from localStorage (for anonymous users)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setLocalDismissedIds(new Set(parsed));
      }
    } catch (error) {
      console.warn('Failed to load dismissed broadcasts:', error);
    }
  }, []);

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

  // Fetch active messages - stable callback without excessive dependencies
  const fetchMessages = useCallback(async () => {
    // Don't fetch if tutorial is not completed
    if (!isTutorialCompleted()) {
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

    console.log(`[Broadcast] Fetching messages (count: ${fetchCountRef.current})`);

    try {
      const url = address 
        ? `/api/broadcast/active?address=${address}`
        : '/api/broadcast/active';
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.success && Array.isArray(data.messages)) {
        // Filter out locally dismissed messages (for anonymous users)
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
  }, [address, localDismissedIds]);

  // Dismiss a message
  const dismissMessage = useCallback(async (messageId: string) => {
    // Optimistically remove from UI
    setMessages(prev => prev.filter(msg => msg.id !== messageId));
    
    // Track dismissal locally
    const newDismissed = new Set(localDismissedIds);
    newDismissed.add(messageId);
    setLocalDismissedIds(newDismissed);
    
    // Persist to localStorage (fallback for anonymous users)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...newDismissed]));
    } catch (error) {
      console.warn('Failed to save dismissed broadcasts:', error);
    }
    
    // Send dismissal to server (if user is connected)
    if (address) {
      try {
        await fetch('/api/broadcast/dismiss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId, address }),
        });
      } catch (error) {
        console.error('Failed to record dismissal:', error);
      }
    }
  }, [address, localDismissedIds]);

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
    console.log('[Broadcast] Initializing polling system');
    
    // Initial fetch
    fetchMessages();

    // Set up polling interval (only once)
    pollingIntervalRef.current = setInterval(() => {
      console.log('[Broadcast] Polling interval triggered');
      fetchMessages();
    }, POLL_INTERVAL);

    // Cleanup on unmount
    return () => {
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
    if (address !== undefined) {
      console.log('[Broadcast] Wallet address changed, fetching messages');
      fetchMessages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]); // Only depend on address, not fetchMessages

  return {
    messages,
    loading,
    dismissMessage,
    trackImpression,
    refresh: fetchMessages,
  };
}

