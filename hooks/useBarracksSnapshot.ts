"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { barracksGetConfigV2, barracksGetLandStateV2, barracksGetLastIncomingReportV2, barracksGetLastOutgoingReportV2 } from '@/lib/contracts';
import type { BarracksConfigV2, BarracksLandStateV2, BarracksRaidReportV2 } from '@/lib/types';

export type BarracksSnapshotV2 = { config: BarracksConfigV2 | null; landState: BarracksLandStateV2 | null;
  lastOutgoingReport: BarracksRaidReportV2 | null; lastIncomingReport: BarracksRaidReportV2 | null };
const emptySnapshot: BarracksSnapshotV2 = { config: null, landState: null, lastOutgoingReport: null, lastIncomingReport: null };
export async function readBarracksSnapshot(landId: bigint): Promise<BarracksSnapshotV2> {
  const [config, landState, lastOutgoingReport, lastIncomingReport] = await Promise.all([
    barracksGetConfigV2(), barracksGetLandStateV2(landId), barracksGetLastOutgoingReportV2(landId), barracksGetLastIncomingReportV2(landId),
  ]);
  return { config, landState, lastOutgoingReport, lastIncomingReport };
}

/** Block refreshes and receipt reconciliation share one land-scoped snapshot authority. */
export function useBarracksSnapshot({ landId, currentBlock, read = readBarracksSnapshot }: {
  landId: bigint; currentBlock?: bigint; read?: typeof readBarracksSnapshot;
}) {
  const [state, setState] = useState<{ landId: bigint | null; loading: boolean; snapshot: BarracksSnapshotV2 }>({ landId: null, loading: true, snapshot: emptySnapshot });
  const currentLand = useRef(landId);
  currentLand.current = landId;
  const request = useRef(0);
  const loadState = useCallback(async (showLoading = true): Promise<BarracksSnapshotV2 | null> => {
    if (currentLand.current !== landId) return null;
    const id = ++request.current;
    if (showLoading) setState(previous => ({ ...previous, loading: true }));
    try {
      const snapshot = await read(landId);
      if (currentLand.current !== landId || request.current !== id) return null;
      setState({ landId, loading: false, snapshot });
      return snapshot;
    } catch {
      if (currentLand.current === landId && request.current === id) setState({ landId, loading: false, snapshot: emptySnapshot });
      return null;
    }
  }, [landId, read]);
  const invalidateRead = useCallback(() => { request.current++; }, []);
  useEffect(() => {
    void loadState();
    return invalidateRead;
  }, [currentBlock, invalidateRead, loadState]);
  const current = state.landId === landId;
  return { ...(current ? state.snapshot : emptySnapshot), loading: !current || state.loading,
    loadedStateLandId: state.landId, loadState };
}
