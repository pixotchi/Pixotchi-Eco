'use client';

import { useEffect, useMemo, useRef, useState, useEffectEvent } from 'react';
import { isAddress } from 'viem';

const cache = new Map<string, string | null>();
const queue = new Set<string>();
let flushTimeout: ReturnType<typeof setTimeout> | null = null;

async function flushQueue() {
  if (queue.size === 0) return;

  const addresses = Array.from(queue);
  queue.clear();

  try {
    const response = await fetch('/api/ens/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses }),
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    const names = data?.names ?? {};

    addresses.forEach((addr) => {
      const resolved = names[addr] ?? null;
      cache.set(addr, resolved);
    });
  } catch (error) {
    addresses.forEach((addr) => {
      cache.set(addr, null);
    });
    console.error('[usePrimaryName] Failed to resolve names', error);
  }
}

function enqueue(address: string) {
  queue.add(address);
  if (flushTimeout) {
    clearTimeout(flushTimeout);
  }
  flushTimeout = setTimeout(() => {
    flushTimeout = null;
    flushQueue();
  }, 50);
}

function waitForResult(address: string, callback: (value: string | null) => void) {
  let frameId: number;

  const check = () => {
    if (cache.has(address)) {
      callback(cache.get(address) ?? null);
      return;
    }
    frameId = requestAnimationFrame(check);
  };

  frameId = requestAnimationFrame(check);

  return () => cancelAnimationFrame(frameId);
}

export function usePrimaryName(address?: string | null, options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const normalised = useMemo(() => {
    if (!address || !isAddress(address)) return null;
    return address.toLowerCase();
  }, [address]);

  const [state, setState] = useState<{ name: string | null; loading: boolean; error: string | null }>(() => {
    if (!normalised) return { name: null, loading: false, error: null };
    if (cache.has(normalised)) {
      return { name: cache.get(normalised) ?? null, loading: false, error: null };
    }
    return { name: null, loading: true, error: null };
  });

  const cancelRef = useRef<(() => void) | null>(null);

  // ✅ useEffectEvent: Handle cache resolution without depending on setState
  const handleCacheResolved = useEffectEvent((value: string | null) => {
    setState({ name: value, loading: false, error: null });
  });

  useEffect(() => {
    cancelRef.current?.();

    if (!enabled || !normalised) {
      setState({ name: null, loading: false, error: null });
      return () => {
        cancelRef.current?.();
      };
    }

    if (cache.has(normalised)) {
      setState({ name: cache.get(normalised) ?? null, loading: false, error: null });
      return () => {
        cancelRef.current?.();
      };
    }

    setState((prev: { name: string | null; loading: boolean; error: string | null }) => ({ ...prev, loading: true, error: null }));
    enqueue(normalised);
    // ✅ Pass useEffectEvent callback - always sees latest state without triggering effect churn
    cancelRef.current = waitForResult(normalised, handleCacheResolved);

    return () => {
      cancelRef.current?.();
    };
  }, [enabled, normalised, handleCacheResolved]);

  return state;
}
