'use client';

import { useEffect, useState } from 'react';
import { BASE_MARK_INITIAL_COLORS, BASE_MARK_PALETTE, type BaseMarkColors } from '@/components/ui/base-mark';
import { usePerformanceMode } from '@/components/ui/performance-mode';

const randomColor = () => BASE_MARK_PALETTE[Math.floor(Math.random() * BASE_MARK_PALETTE.length)];

/** Both Base marks use one lifecycle policy, with no decorative work in a hidden document. */
export function useBaseMarkColors(active: boolean): BaseMarkColors {
  const { enabled: performanceModeEnabled } = usePerformanceMode();
  const [colors, setColors] = useState<BaseMarkColors>(BASE_MARK_INITIAL_COLORS);
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let initial: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      clearTimeout(initial);
      clearInterval(interval);
      initial = undefined;
      interval = undefined;
    };
    const change = () => {
      // Also guard the callback: an already-queued tick may meet a visibility change.
      if (document.hidden || reducedMotion.matches || performanceModeEnabled) return;
      setColors([randomColor(), randomColor(), randomColor(), randomColor()]);
    };
    const sync = () => {
      stop();
      if (!active || document.hidden || reducedMotion.matches || performanceModeEnabled) return;
      initial = setTimeout(change, 100);
      interval = setInterval(change, 1500);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    const modernMediaListener = typeof reducedMotion.addEventListener === 'function';
    if (modernMediaListener) reducedMotion.addEventListener('change', sync);
    else reducedMotion.addListener(sync);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', sync);
      if (modernMediaListener) reducedMotion.removeEventListener('change', sync);
      else reducedMotion.removeListener(sync);
    };
  }, [active, performanceModeEnabled]);
  return colors;
}
