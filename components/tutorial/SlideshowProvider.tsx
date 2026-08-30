"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  TASKS_TUTORIAL_SLIDE_ID,
  TUTORIAL_SLIDE_IDS,
  TUTORIAL_VERSION,
  type TutorialSlideId,
} from "./config";
import { getClientGamificationPolicy } from "@/lib/gamification-client";

type SlideshowContextType = {
  open: boolean;
  index: number;
  slideIds: readonly TutorialSlideId[];
  enabled: boolean;
  start: (opts?: { reset?: boolean }) => void;
  startIfFirstVisit: () => void;
  close: () => void;
  next: () => void;
  prev: () => void;
  goto: (i: number) => void;
};

const SlideshowContext = createContext<SlideshowContextType | null>(null);

const STORAGE_KEY = "pixotchi:tutorial";

export function SlideshowProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const gamificationPolicy = getClientGamificationPolicy();
  const slideIds = useMemo(
    () =>
      gamificationPolicy.visible
        ? TUTORIAL_SLIDE_IDS
        : TUTORIAL_SLIDE_IDS.filter((slideId) => slideId !== TASKS_TUTORIAL_SLIDE_ID),
    [gamificationPolicy.visible],
  );

  const envEnabled = typeof window !== "undefined" ? (process.env.NEXT_PUBLIC_TUTORIAL_SLIDESHOW || "on") === "on" : true;

  // Defer auto-start until explicitly requested by the app after wallet connect
  const startIfFirstVisit = useCallback(() => {
    if (!envEnabled) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const now = Date.now();
      const stored = raw ? JSON.parse(raw) as { version: string; lastIndex?: number; completed?: boolean; firstSeenAt?: number } : null;
      if (!stored) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: TUTORIAL_VERSION, lastIndex: 0, completed: false, firstSeenAt: now }));
        setIndex(0);
        setOpen(true);
        return;
      }
      if (stored.version !== TUTORIAL_VERSION) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: TUTORIAL_VERSION, lastIndex: 0, completed: false, firstSeenAt: stored.firstSeenAt ?? now }));
        setIndex(0);
        setOpen(true);
        return;
      }
      if (!stored.completed) {
        setIndex(Math.min(stored.lastIndex ?? 0, slideIds.length - 1));
        setOpen(true);
      }
    } catch {}
  }, [envEnabled, slideIds.length]);

  const persist = useCallback((data: Partial<{ lastIndex: number; completed: boolean }>) => {
    try {
      const currentRaw = localStorage.getItem(STORAGE_KEY);
      const current = currentRaw ? JSON.parse(currentRaw) : {};
      const merged = { version: TUTORIAL_VERSION, ...current, ...data };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {}
  }, []);

  const start = useCallback((opts?: { reset?: boolean }) => {
    // Allow manual start even if env is disabled? We keep env gate to avoid surprises in prod.
    if (!envEnabled) return;
    setOpen(true);
    const newIndex = opts?.reset ? 0 : index;
    setIndex(newIndex);
    persist({ lastIndex: newIndex, completed: false });
  }, [envEnabled, index, persist]);

  const close = useCallback(() => {
    setOpen(false);
    persist({ completed: true });
  }, [persist]);

  const next = useCallback(() => {
    setIndex((i) => {
      const ni = Math.min(i + 1, slideIds.length - 1);
      persist({ lastIndex: ni, completed: ni === slideIds.length - 1 });
      if (ni === slideIds.length - 1) {
        // keep open; user can close at the end
      }
      return ni;
    });
  }, [slideIds.length, persist]);

  const prev = useCallback(() => {
    setIndex((i) => {
      const ni = Math.max(i - 1, 0);
      persist({ lastIndex: ni });
      return ni;
    });
  }, [persist]);

  const goto = useCallback((i: number) => {
    const clamped = Math.min(Math.max(i, 0), slideIds.length - 1);
    setIndex(clamped);
    persist({ lastIndex: clamped });
  }, [slideIds.length, persist]);

  const value = useMemo(() => ({ open, index, slideIds, enabled: envEnabled, start, startIfFirstVisit, close, next, prev, goto }), [open, index, slideIds, envEnabled, start, startIfFirstVisit, close, next, prev, goto]);

  return (
    <SlideshowContext.Provider value={value}>
      {children}
    </SlideshowContext.Provider>
  );
}

export function useSlideshow() {
  const ctx = useContext(SlideshowContext);
  if (!ctx) throw new Error("useSlideshow must be used within SlideshowProvider");
  return ctx;
}
