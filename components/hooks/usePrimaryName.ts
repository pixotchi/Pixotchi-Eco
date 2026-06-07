'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { isAddress } from 'viem';

const cache = new Map<string, string | null>();
const queue = new Set<string>();
const subscribers = new Map<string, Set<(value: string | null) => void>>();
let flushTimeout: ReturnType<typeof setTimeout> | null = null;

function notifySubscribers(address: string) {
  const callbacks = subscribers.get(address);
  if (!callbacks) return;

  const value = cache.get(address) ?? null;
  callbacks.forEach((callback) => callback(value));
  subscribers.delete(address);
}

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
      addresses.forEach((addr) => {
        cache.set(addr, null);
        notifySubscribers(addr);
      });
      console.warn(`[usePrimaryName] Name resolver returned ${response.status}`);
      return;
    }

    const data = await response.json();
    const names = data?.names ?? {};

    addresses.forEach((addr) => {
      const resolved = names[addr] ?? null;
      cache.set(addr, resolved);
      notifySubscribers(addr);
    });
  } catch (error) {
    addresses.forEach((addr) => {
      cache.set(addr, null);
      notifySubscribers(addr);
    });
    console.warn('[usePrimaryName] Failed to resolve names', error);
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
  if (cache.has(address)) {
    callback(cache.get(address) ?? null);
    return () => {};
  }

  let callbacks = subscribers.get(address);
  if (!callbacks) {
    callbacks = new Set();
    subscribers.set(address, callbacks);
  }
  callbacks.add(callback);

  return () => {
    callbacks?.delete(callback);
    if (callbacks?.size === 0) {
      subscribers.delete(address);
    }
  };
}

type PrimaryNameState = {
  address: string | null;
  name: string | null;
  loading: boolean;
  error: string | null;
};

function makeInitialState(address: string | null): PrimaryNameState {
  if (!address) {
    return { address: null, name: null, loading: false, error: null };
  }
  if (cache.has(address)) {
    return { address, name: cache.get(address) ?? null, loading: false, error: null };
  }
  return { address, name: null, loading: true, error: null };
}

export function usePrimaryName(address?: string | null, options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const normalised = useMemo(() => {
    if (!address || !isAddress(address)) return null;
    return address.toLowerCase();
  }, [address]);

  const [state, setState] = useState<PrimaryNameState>(() => makeInitialState(normalised));

  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    cancelRef.current?.();

    if (!enabled || !normalised) {
      setState({ address: null, name: null, loading: false, error: null });
      return () => {
        cancelRef.current?.();
      };
    }

    if (cache.has(normalised)) {
      setState({ address: normalised, name: cache.get(normalised) ?? null, loading: false, error: null });
      return () => {
        cancelRef.current?.();
      };
    }

    setState({ address: normalised, name: null, loading: true, error: null });
    enqueue(normalised);
    cancelRef.current = waitForResult(normalised, (value) => {
      setState((prev) => {
        if (prev.address !== normalised) {
          return prev;
        }
        return { address: normalised, name: value, loading: false, error: null };
      });
    });

    return () => {
      cancelRef.current?.();
    };
  }, [enabled, normalised]);

  const isCurrent = state.address === normalised;

  return {
    name: isCurrent ? state.name : null,
    loading: !enabled || !normalised ? false : (!isCurrent || state.loading),
    error: isCurrent ? state.error : null,
  };
}
