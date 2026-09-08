"use client";

import { useEffect, useState } from "react";

type ArcadeDeadlines = { normal: number; star: number; spin: number | null; reveal: number | null };

const secondsUntil = (deadline: number | null, now: number) =>
  deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));

/** One elapsed-time clock for both Box modes, Spin cooldown and cosmetic reveal delay. */
export function useArcadeCountdowns({ normal, star, spin, reveal }: ArcadeDeadlines, enabled: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      clearTimeout(timeout);
      const current = Date.now();
      setNow(current);
      if (document.visibilityState === "hidden") return;
      const remaining = Math.max(normal, star, spin ?? 0, reveal ?? 0) - current;
      if (remaining > 0) timeout = setTimeout(tick, Math.min(1000, remaining));
    };
    tick();
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [enabled, normal, reveal, spin, star]);
  return {
    normal: secondsUntil(normal, now), star: secondsUntil(star, now),
    spin: secondsUntil(spin, now), reveal: secondsUntil(reveal, now),
  };
}
