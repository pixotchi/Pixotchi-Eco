import { useCallback, useEffect, useRef, useState } from 'react';

/** A section owns its read lifetime; hidden/unmounted sections cannot publish late results. */
export function useAdminRead<T>({ adminKey, isActive, endpoint, parse, label }: {
  adminKey: string; isActive: boolean; endpoint: string; parse: (value: unknown) => T | null; label: string;
}) {
  const [data, setData] = useState<T | null>(null);
  const [dataScope, setDataScope] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setData(null);
    setLoading(true);
    setError(null);
    const timeout = setTimeout(() => controller.abort('timeout'), 15_000);
    try {
      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${adminKey}` }, signal: controller.signal });
      if (!response.ok) throw new Error(`${label} could not be loaded. Try again.`);
      const value: unknown = await response.json();
      const snapshot = parse(value);
      if (!snapshot) throw new Error(`${label} data could not be read. Try loading it again.`);
      if (!controller.signal.aborted && pending.current === controller) {
        setDataScope(`${adminKey}\u0000${endpoint}`);
        setData(snapshot);
      }
    } catch (cause) {
      if (pending.current !== controller || (controller.signal.aborted && controller.signal.reason !== 'timeout')) return;
      // Lists drive privileged actions. An invalid refresh must not keep old targets actionable.
      setData(null);
      setError(controller.signal.reason === 'timeout' ? `${label} request timed out. Try again.` : cause instanceof Error ? cause.message : `${label} could not be loaded. Try again.`);
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) { pending.current = null; setLoading(false); }
    }
  }, [adminKey, endpoint, label, parse]);
  useEffect(() => {
    if (isActive) void reload();
    return () => { pending.current?.abort(); pending.current = null; };
  }, [isActive, reload]);
  return { data: dataScope === `${adminKey}\u0000${endpoint}` ? data : null, setData, loading, error, reload };
}
