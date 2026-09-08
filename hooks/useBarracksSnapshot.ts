"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { barracksGetConfigV2, barracksGetLandStateV2, barracksGetLastIncomingReportV2, barracksGetLastOutgoingReportV2 } from '@/lib/contracts';
import type { BarracksConfigV2, BarracksLandStateV2, BarracksRaidReportV2 } from '@/lib/types';

export type BarracksSnapshotV2 = { config: BarracksConfigV2 | null; landState: BarracksLandStateV2 | null;
  lastOutgoingReport: BarracksRaidReportV2 | null; lastIncomingReport: BarracksRaidReportV2 | null };
const emptySnapshot: BarracksSnapshotV2 = { config: null, landState: null, lastOutgoingReport: null, lastIncomingReport: null };
export async function readBarracksSnapshot(landId: bigint, includeReports = true): Promise<BarracksSnapshotV2> {
  const [config, landState, lastOutgoingReport, lastIncomingReport] = await Promise.all([
    barracksGetConfigV2(), barracksGetLandStateV2(landId),
    includeReports ? barracksGetLastOutgoingReportV2(landId) : null,
    includeReports ? barracksGetLastIncomingReportV2(landId) : null,
  ]);
  return { config, landState, lastOutgoingReport, lastIncomingReport };
}

/** A retained land snapshot refreshes on a bounded clock, independently of block ticks. */
export function useBarracksSnapshot({ landId, read = readBarracksSnapshot }: {
  landId: bigint; currentBlock?: bigint; read?: typeof readBarracksSnapshot;
}) {
  const [state, setState] = useState<{ landId: bigint | null; loading: boolean; error: boolean; snapshot: BarracksSnapshotV2 }>({ landId: null, loading: true, error: false, snapshot: emptySnapshot });
  const currentLand = useRef(landId);
  currentLand.current = landId;
  const request = useRef(0);
  const inFlightLand = useRef<bigint | null>(null);
  const loadState = useCallback(async (showLoading = true, includeReports = true): Promise<BarracksSnapshotV2 | null> => {
    if (currentLand.current !== landId) return null;
    if (!showLoading && !includeReports && inFlightLand.current === landId) return null;
    const id = ++request.current;
    inFlightLand.current = landId;
    if (showLoading) setState(previous => ({ ...previous, loading: true }));
    try {
      const snapshot = await read(landId, includeReports);
      if (!snapshot.config || !snapshot.landState) throw new Error('Barracks snapshot unavailable');
      if (currentLand.current !== landId || request.current !== id) return null;
      setState(previous => ({ landId, loading: false, error: false, snapshot: includeReports ? snapshot : {
        ...snapshot, lastOutgoingReport: previous.landId === landId ? previous.snapshot.lastOutgoingReport : null,
        lastIncomingReport: previous.landId === landId ? previous.snapshot.lastIncomingReport : null,
      } }));
      return snapshot;
    } catch {
      if (currentLand.current === landId && request.current === id) setState(previous => ({ landId, loading: false, error: true,
        snapshot: previous.landId === landId ? previous.snapshot : emptySnapshot }));
      return null;
    } finally {
      if (request.current === id) inFlightLand.current = null;
    }
  }, [landId, read]);
  const invalidateRead = useCallback(() => { request.current++; }, []);
  useEffect(() => {
    void loadState(true, false);
    const interval = setInterval(() => { void loadState(false, false); }, 30_000);
    return () => { clearInterval(interval); invalidateRead(); };
  }, [invalidateRead, loadState]);
  const current = state.landId === landId;
  return { ...(current ? state.snapshot : emptySnapshot), loading: !current || state.loading,
    error: current && state.error, loadedStateLandId: state.landId, loadState };
}
