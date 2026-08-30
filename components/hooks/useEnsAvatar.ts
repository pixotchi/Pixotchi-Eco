'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { isAddress } from 'viem';

import { createBatchedAddressResolver } from './createBatchedAddressResolver';

// Own resolver instance (state must NOT be shared with usePrimaryName).
const resolver = createBatchedAddressResolver({
  endpoint: '/api/ens/avatars',
  responseKey: 'avatars',
  logLabel: 'useEnsAvatar',
});

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
  const cached = resolver.getCached(address);
  if (cached.hit) {
    return { address, avatar: cached.value, loading: false, error: null };
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

    const cached = resolver.getCached(normalized);
    if (cached.hit) {
      setState({
        address: normalized,
        avatar: cached.value,
        loading: false,
        error: null,
      });
      return () => {
        cancelRef.current?.();
      };
    }

    setState({ address: normalized, avatar: null, loading: true, error: null });
    resolver.enqueue(normalized);
    cancelRef.current = resolver.waitForResult(normalized, (value) => {
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
