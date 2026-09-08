"use client";

import { useState, useEffect } from "react";
import { formatCountdownDuration } from "@/lib/duration-display";

export function useCountdown(targetTimestamp: number, showSeconds = true) {
  const [snapshot, setSnapshot] = useState<{
    target: number;
    seconds: boolean;
    label: string;
  } | null>(null);
  const target =
    Number.isFinite(targetTimestamp) &&
    targetTimestamp > 0 &&
    targetTimestamp <= Number.MAX_SAFE_INTEGER / 1000
      ? targetTimestamp
      : 0;

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (timeout !== undefined) clearTimeout(timeout);
    };
    const update = () => {
      stop();
      const remainingMs = Math.max(0, target * 1000 - Date.now());
      setSnapshot({
        target,
        seconds: showSeconds,
        label: formatCountdownDuration(
          BigInt(Math.ceil(remainingMs / 1000)),
          showSeconds,
        ),
      });
      if (remainingMs === 0) {
        document.removeEventListener("visibilitychange", update);
        return;
      }
      // Hidden tabs catch up on return. Minute-only timers do no second work.
      if (document.visibilityState === "hidden") return;
      const cadence = showSeconds ? 1000 : 60000;
      timeout = setTimeout(
        update,
        Math.min(remainingMs, remainingMs % cadence || cadence),
      );
    };
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", update);
    };
  }, [target, showSeconds]);

  if (snapshot?.target === target && snapshot.seconds === showSeconds)
    return snapshot.label;
  return target === 0 ? formatCountdownDuration(BigInt(0), showSeconds) : "…";
}
