'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { isAddress } from 'viem';

import { createBatchedAddressResolver } from './createBatchedAddressResolver';

// Own resolver instance (state must NOT be shared with useEnsAvatar).
const resolver = createBatchedAddressResolver({
  endpoint: '/api/ens/resolve',
  responseKey: 'names',
  logLabel: 'usePrimaryName',
});

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
  const cached = resolver.getCached(address);
  if (cached.hit) {
    return { address, name: cached.value, loading: false, error: null };
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

    const cached = resolver.getCached(normalised);
    if (cached.hit) {
      setState({ address: normalised, name: cached.value, loading: false, error: null });
      return () => {
        cancelRef.current?.();
      };
    }

    setState({ address: normalised, name: null, loading: true, error: null });
    resolver.enqueue(normalised);
    cancelRef.current = resolver.waitForResult(normalised, (value) => {
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
