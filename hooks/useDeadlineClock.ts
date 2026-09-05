"use client";

import { useEffect, useState } from 'react';

/** Wake at rule boundaries, without rerendering a whole ranking every second. */
export function useDeadlineClock(deadlines: readonly number[], enabled = true): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      const current = Math.floor(Date.now() / 1000);
      setNow(current);
      if (document.visibilityState === 'hidden') return;
      const next = deadlines.reduce((earliest, time) => (
        Number.isFinite(time) && time > current ? Math.min(earliest, time) : earliest
      ), Infinity);
      if (Number.isFinite(next)) {
        timer = setTimeout(update, Math.min(next * 1000 - Date.now(), 2_147_483_647));
      }
    };
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
    };
  }, [deadlines, enabled]);

  return now;
}
