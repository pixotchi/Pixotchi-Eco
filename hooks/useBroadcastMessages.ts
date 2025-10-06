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

  // Check tutorial completion status periodically
  useEffect(() => {
    const checkTutorial = () => {
      setTutorialCompleted(isTutorialCompleted());
    };
    
    // Check immediately
    checkTutorial();
    
    // Check every 2 seconds to detect when tutorial completes
    const interval = setInterval(checkTutorial, 2000);
    
    return () => clearInterval(interval);
  }, []);

  // Fetch active messages
  const fetchMessages = useCallback(async () => {
    // Don't fetch if tutorial is not completed
    if (!tutorialCompleted) {
      return;
    }

    // Prevent excessive polling
    const now = Date.now();
    if (now - lastFetchRef.current < 5000) {
      return; // Don't fetch more than once per 5 seconds
    }
    lastFetchRef.current = now;

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
      }
    } catch (error) {
      console.error('Failed to fetch broadcast messages:', error);
    } finally {
      setLoading(false);
    }
  }, [address, localDismissedIds, tutorialCompleted]);

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

  // Initial fetch
  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Set up polling
  useEffect(() => {
    // Clear any existing interval
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    // Start new polling interval
    pollingIntervalRef.current = setInterval(fetchMessages, POLL_INTERVAL);

    // Cleanup
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [fetchMessages]);

  // Refresh when wallet connects/disconnects
  useEffect(() => {
    if (address !== undefined) {
      fetchMessages();
    }
  }, [address, fetchMessages]);

  return {
    messages,
    loading,
    dismissMessage,
    trackImpression,
    refresh: fetchMessages,
  };
}

