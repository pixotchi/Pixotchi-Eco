"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useOwnerOperationScope } from '@/hooks/useOwnerOperationScope';

type View = 'all' | 'my';
type MyActivity<T> = { activities: T[]; landIds: string[]; plantIds: string[] };

export function useActivityFeeds<T, R>({ owner, visible, loadAll, loadMy, transform }: {
  owner: string | null;
  visible: boolean;
  loadAll: () => Promise<T[]>;
  loadMy: (owner: string) => Promise<MyActivity<T>>;
  transform: (events: T[]) => R[];
}) {
  const ownerKey = owner?.toLowerCase() ?? null;
  const scope = useOwnerOperationScope(ownerKey);
  const [activitiesByView, setActivities] = useState<Record<View, R[]>>({ all: [], my: [] });
  const [loadingByView, setLoading] = useState({ all: true, my: Boolean(owner) });
  const [errorByView, setError] = useState<Record<View, string | null>>({ all: null, my: null });
  const [lastSuccessByView, setLastSuccess] = useState<Record<View, number | null>>({ all: null, my: null });
  const [myAssetIds, setAssets] = useState<{ address: string | null; landIds: string[]; plantIds: string[] }>({ address: null, landIds: [], plantIds: [] });
  const rowsRef = useRef(activitiesByView);
  const pendingRef = useRef<object | null>(null);
  const freshnessRef = useRef<{ owner: string | null; time: number } | null>(null);

  useLayoutEffect(() => {
    pendingRef.current = null;
    freshnessRef.current = null;
    rowsRef.current = { ...rowsRef.current, my: [] };
    setActivities(previous => ({ ...previous, my: [] }));
    setLoading(previous => ({ ...previous, my: Boolean(ownerKey) }));
    setError(previous => ({ ...previous, my: null }));
    setLastSuccess(previous => ({ ...previous, my: null }));
    setAssets({ address: null, landIds: [], plantIds: [] });
  }, [ownerKey]);

  useEffect(() => { rowsRef.current = activitiesByView; }, [activitiesByView]);

  const refresh = useCallback(async () => {
    if (pendingRef.current) return;
    const request = {};
    const operation = scope.capture();
    pendingRef.current = request;
    const isCurrent = () => operation.isCurrent() && pendingRef.current === request;
    const views: View[] = owner ? ['all', 'my'] : ['all'];
    setLoading(previous => ({
      all: rowsRef.current.all.length === 0 ? true : previous.all,
      my: Boolean(owner) && rowsRef.current.my.length === 0,
    }));
    setError({ all: null, my: null });
    try {
      const results = await Promise.allSettled(views.map(async view => {
        if (view === 'my' && owner) {
          const data = await loadMy(owner);
          return { view, rows: transform(data.activities), assets: { address: owner, landIds: data.landIds, plantIds: data.plantIds } };
        }
        return { view, rows: transform(await loadAll()), assets: null };
      }));
      if (!isCurrent()) return;
      setLastSuccess(previous => {
        const next = { ...previous };
        results.forEach(result => { if (result.status === 'fulfilled') next[result.value.view] = Date.now(); });
        return next;
      });
      setActivities(previous => {
        const next = { ...previous };
        results.forEach(result => { if (result.status === 'fulfilled') next[result.value.view] = result.value.rows; });
        return next;
      });
      results.forEach(result => { if (result.status === 'fulfilled' && result.value.assets) setAssets(result.value.assets); });
      setError(previous => {
        const next = { ...previous };
        results.forEach((result, index) => { next[views[index]] = result.status === 'rejected' ? 'Failed to load activities. Please try again later.' : null; });
        return next;
      });
    } finally {
      if (isCurrent()) {
        pendingRef.current = null;
        setLoading({ all: false, my: false });
      }
    }
  }, [loadAll, loadMy, owner, scope, transform]);

  useEffect(() => {
    if (!visible) return;
    const previous = freshnessRef.current;
    if (previous?.owner === ownerKey && Date.now() - previous.time < 30_000) return;
    freshnessRef.current = { owner: ownerKey, time: Date.now() };
    void refresh();
  }, [ownerKey, refresh, visible]);

  return { activitiesByView, loadingByView, errorByView, lastSuccessByView, myAssetIds, refresh };
}
