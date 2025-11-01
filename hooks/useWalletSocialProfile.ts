import { useCallback, useEffect, useRef, useState } from 'react';
import type { SocialProfilePayload } from '@/lib/social-profile';

interface UseWalletSocialProfileResult {
  data: SocialProfilePayload | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  cached: boolean;
}

interface UseWalletSocialProfileOptions {
  enabled?: boolean;
  identifier?: string | null;
}

export function useWalletSocialProfile(
  address?: string | null,
  options: UseWalletSocialProfileOptions = {},
): UseWalletSocialProfileResult {
  const enabled = options.enabled ?? true;
  const identifier = options.identifier?.trim() || null;
  const [data, setData] = useState<SocialProfilePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const doFetch = useCallback(async () => {
    const targetAddress = address?.trim();
    if (!targetAddress || !enabled) {
      if (mountedRef.current) {
        setData(null);
        setCached(false);
        setError(null);
        setLoading(false);
      }
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const params = new URLSearchParams({ address: targetAddress });
      if (identifier && identifier.toLowerCase() !== targetAddress.toLowerCase()) {
        params.set('identifier', identifier);
      }
      const resp = await fetch(`/api/profile/social?${params.toString()}`, {
        method: 'GET',
        signal: controller.signal,
      });

      // Check if component is still mounted before processing response
      if (!mountedRef.current) return;

      if (!resp.ok) {
        const payload = await resp.json().catch(() => ({}));
        throw new Error(payload.error || `Request failed with status ${resp.status}`);
      }

      const body = await resp.json();
      
      // Check again after async operation
      if (!mountedRef.current) return;
      
      setData(body.data ?? null);
      setCached(Boolean(body.cached));
    } catch (fetchError: any) {
      if (fetchError?.name === 'AbortError') return;
      console.error('[useWalletSocialProfile] Failed to fetch social profile', fetchError);
      
      // Only update state if component is still mounted
      if (mountedRef.current) {
        setError(fetchError?.message || 'Failed to load social profile');
        setData(null);
        setCached(false);
      }
    } finally {
      // Only update loading state if component is still mounted
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [address, enabled, identifier]);

  useEffect(() => {
    mountedRef.current = true;
    doFetch();
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, [doFetch]);

  const refresh = useCallback(async () => {
    await doFetch();
  }, [doFetch]);

  return {
    data,
    loading,
    error,
    refresh,
    cached,
  };
}

