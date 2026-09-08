'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseStatusSnapshot, type StatusSnapshot } from '@/lib/status-snapshot';

export const STATUS_REQUEST_TIMEOUT_MS = 12_000;
// Health sweeps run every 15 minutes; allow the public cache a five-minute grace period.
export const STATUS_STALE_AFTER_MS = 20 * 60_000;

export function useStatusSnapshot(initialSnapshot: StatusSnapshot) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const active = useRef<AbortController | null>(null);
  const lastRefreshAtRef = useRef(Date.now());
  const refresh = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(null);
    const timer = window.setTimeout(() => controller.abort(), STATUS_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch('/api/status/checks', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('The latest status could not be fetched. Please retry.');
      const data = parseStatusSnapshot(await response.json());
      if (!data) throw new Error('The status response was invalid. Please retry.');
      if (active.current === controller && !controller.signal.aborted) {
        setSnapshot(data);
        lastRefreshAtRef.current = Date.now();
        setNow(Date.now());
      }
    } catch (cause) {
      if (active.current === controller) setError(controller.signal.aborted
        ? 'The status request timed out. Please retry.'
        : cause instanceof Error ? cause.message : 'Unable to refresh status. Please retry.');
    } finally {
      window.clearTimeout(timer);
      if (active.current === controller) { active.current = null; setPending(false); }
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      window.clearInterval(timer);
      const controller = active.current;
      active.current = null;
      controller?.abort();
    };
  }, []);
  const isStale = now - Date.parse(snapshot.generatedAt) > STATUS_STALE_AFTER_MS;
  return { snapshot, isPending, error, refresh, isStale, lastRefreshAtRef };
}
