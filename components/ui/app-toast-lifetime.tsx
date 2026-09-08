"use client";

import { useEffect, useRef } from "react";
import toast, { type Toast } from "react-hot-toast";

/** Count time actually offered to the reader, independently for each version
 * of a toast. A loading toast resolved during a pause gets a full result window. */
export function AppToastLifetime({ notification, paused }: { notification: Toast; paused: boolean }) {
  const { id, createdAt, type, duration = 4000, visible, dismissed, removeDelay = 1000 } = notification;
  const elapsed = useRef({ createdAt, type, duration, time: 0 });

  useEffect(() => {
    if (elapsed.current.createdAt !== createdAt || elapsed.current.type !== type || elapsed.current.duration !== duration) {
      elapsed.current = { createdAt, type, duration, time: 0 };
    }
    if (!visible || dismissed || paused || document.hidden || !Number.isFinite(duration)) return;
    const started = Date.now();
    const timer = window.setTimeout(() => toast.dismiss(id), Math.max(0, duration - elapsed.current.time));
    return () => {
      window.clearTimeout(timer);
      elapsed.current.time += Math.max(0, Date.now() - started);
    };
  }, [id, createdAt, type, duration, visible, dismissed, paused]);

  // Explicit dismissal still removes infinite/custom notifications. Removal is
  // independent of display pauses, and an ID reused before removal cancels it.
  useEffect(() => {
    if (!dismissed) return;
    const timer = window.setTimeout(() => toast.remove(id), removeDelay);
    return () => window.clearTimeout(timer);
  }, [id, dismissed, removeDelay]);

  return null;
}
