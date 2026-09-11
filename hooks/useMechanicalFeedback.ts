"use client";
import { useEffect } from "react";
import { microSound, useSensoryPreferences } from "@/lib/sensory-feedback";

/** A short texture at spin start; network waits never produce an endless sound loop. */
export function useMechanicalFeedback(spinning: boolean) {
  const { sounds } = useSensoryPreferences();
  useEffect(() => {
    if (!spinning || !sounds) return;
    let count = 0;
    microSound("gear");
    const timer = window.setInterval(() => {
      microSound("gear");
      if (++count >= 8) window.clearInterval(timer);
    }, 180);
    return () => window.clearInterval(timer);
  }, [sounds, spinning]);
}
