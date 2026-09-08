'use client';

import { useEffect, useState } from 'react';

export function useSolanaBootstrap<T extends { hasUsableConnectors: boolean }>(requested: boolean, enabled: boolean, load: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!requested || !enabled) return;
    let current = true;
    setResult(null);
    setFailed(false);
    const timer = window.setTimeout(() => {
      if (current) { current = false; setFailed(true); }
    }, 20_000);
    void Promise.resolve().then(load).then((value) => {
      window.clearTimeout(timer);
      if (current) setResult(value);
    }).catch(() => {
      window.clearTimeout(timer);
      if (current) setFailed(true);
    });
    return () => { current = false; window.clearTimeout(timer); };
  }, [attempt, enabled, load, requested]);
  const state = !requested ? 'ready' : !enabled || failed ? 'unavailable' : result === null ? 'loading' : result.hasUsableConnectors ? 'ready' : 'unavailable';
  return { state, result, retry: () => setAttempt((value) => value + 1) } as const;
}
