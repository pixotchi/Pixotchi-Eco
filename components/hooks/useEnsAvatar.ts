'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { isAddress } from 'viem';

const cache = new Map<string, string | null>();
const queue = new Set<string>();
let flushTimeout: ReturnType<typeof setTimeout> | null = null;

async function flushQueue() {
  if (queue.size === 0) {
    return;
  }

  const addresses = Array.from(queue);
  queue.clear();

  try {
    const response = await fetch('/api/ens/avatars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses }),
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    const avatars = data?.avatars ?? {};

    addresses.forEach((address) => {
      cache.set(address, avatars[address] ?? null);
    });
  } catch (error) {
    addresses.forEach((address) => {
      cache.set(address, null);
    });
    console.error('[useEnsAvatar] Failed to resolve avatars', error);
  }
}

function enqueue(address: string) {
  queue.add(address);
  if (flushTimeout) {
    clearTimeout(flushTimeout);
  }
  flushTimeout = setTimeout(() => {
    flushTimeout = null;
    void flushQueue();
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

type EnsAvatarState = {
  address: string | null;
  avatar: string | null;
  loading: boolean;
  error: string | null;
};

function makeInitialState(address: string | null): EnsAvatarState {
  if (!address) {
    return { address: null, avatar: null, loading: false, error: null };
  }

  if (cache.has(address)) {
    return { address, avatar: cache.get(address) ?? null, loading: false, error: null };
  }

  return { address, avatar: null, loading: true, error: null };
}

export function useEnsAvatar(address?: string | null, options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const normalized = useMemo(() => {
    if (!address || !isAddress(address)) {
      return null;
    }
    return address.toLowerCase();
  }, [address]);

  const [state, setState] = useState<EnsAvatarState>(() => makeInitialState(normalized));
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    cancelRef.current?.();

    if (!enabled || !normalized) {
      setState({ address: null, avatar: null, loading: false, error: null });
      return () => {
        cancelRef.current?.();
      };
    }

    if (cache.has(normalized)) {
      setState({
        address: normalized,
        avatar: cache.get(normalized) ?? null,
        loading: false,
        error: null,
      });
      return () => {
        cancelRef.current?.();
      };
    }

    setState({ address: normalized, avatar: null, loading: true, error: null });
    enqueue(normalized);
    cancelRef.current = waitForResult(normalized, (value) => {
      setState((previous) => {
        if (previous.address !== normalized) {
          return previous;
        }
        return { address: normalized, avatar: value, loading: false, error: null };
      });
    });

    return () => {
      cancelRef.current?.();
    };
  }, [enabled, normalized]);

  const isCurrent = state.address === normalized;

  return {
    avatar: isCurrent ? state.avatar : null,
    loading: !enabled || !normalized ? false : (!isCurrent || state.loading),
    error: isCurrent ? state.error : null,
  };
}
