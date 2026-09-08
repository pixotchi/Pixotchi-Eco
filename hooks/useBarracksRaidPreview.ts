"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { barracksPreviewRaidV2 } from '@/lib/contracts';
import { getRaidPreviewIdentity, getCurrentRaidPreview, requireCurrentRaidPreview, type RaidPreviewState } from '@/lib/barracks-preview-readiness';
import type { BarracksRaidPreviewV2 } from '@/lib/types';

type RaidPreviewReader = (attacker: bigint, defender: bigint, swordsmen: bigint, phalanx: bigint) => Promise<BarracksRaidPreviewV2 | null>;

export function useBarracksRaidPreview({ enabled, owner, landId, targetLandId, swordsmen, phalanx, currentBlock,
  read = barracksPreviewRaidV2,
}: {
  enabled: boolean;
  owner: string | undefined;
  landId: bigint;
  targetLandId: bigint | null;
  swordsmen: bigint | null;
  phalanx: bigint | null;
  currentBlock: bigint;
  read?: RaidPreviewReader;
}) {
  const [state, setState] = useState<RaidPreviewState | null>(null);
  const [retry, setRetry] = useState(0);
  const identity = enabled ? getRaidPreviewIdentity(owner, landId, targetLandId, swordsmen, phalanx) : null;
  const currentRef = useRef({ state, identity });
  currentRef.current = { state, identity };

  useEffect(() => {
    if (!identity || targetLandId === null || swordsmen === null || phalanx === null) {
      setState(null);
      return;
    }
    let cancelled = false;
    setState({ identity, status: 'loading' });
    void (async () => {
      try {
        const preview = await read(landId, targetLandId, swordsmen, phalanx);
        if (cancelled) return;
        if (!preview || preview.swordsmenRequested !== swordsmen || preview.phalanxRequested !== phalanx) {
          throw new Error('The preview did not match the selected troops.');
        }
        setState({ identity, status: 'ready', preview });
      } catch {
        if (!cancelled) setState({ identity, status: 'error', message: 'Raid preview unavailable. Retry to review the selected target and troops.' });
      }
    })();
    return () => { cancelled = true; };
  }, [identity, landId, targetLandId, swordsmen, phalanx, currentBlock, read, retry]);

  const requireReady = useCallback(() => {
    if (identity !== currentRef.current.identity) throw new Error('Your raid selection changed. Review it before submitting.');
    requireCurrentRaidPreview(currentRef.current.state, identity);
  }, [identity]);
  const refresh = useCallback(() => {
    // Immediately invalidate an accepted response while retry waits for its effect.
    if (identity) setState({ identity, status: 'loading' });
    setRetry(value => value + 1);
  }, [identity]);
  return {
    identity,
    preview: getCurrentRaidPreview(state, identity),
    error: state?.identity === identity && state?.status === 'error' ? state.message : null,
    isLoading: identity !== null && (state?.identity !== identity || state?.status === 'loading'),
    requireReady,
    refresh,
  };
}
