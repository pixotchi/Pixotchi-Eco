"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { slides as defaultSlides, TUTORIAL_VERSION, type TutorialSlide } from "./slides";

type SlideshowContextType = {
  open: boolean;
  index: number;
  slides: TutorialSlide[];
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
  const slides = defaultSlides;

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
        setIndex(Math.min(stored.lastIndex ?? 0, slides.length - 1));
        setOpen(true);
      }
    } catch {}
  }, [envEnabled, slides.length]);

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
      const ni = Math.min(i + 1, slides.length - 1);
      persist({ lastIndex: ni, completed: ni === slides.length - 1 });
      if (ni === slides.length - 1) {
        // keep open; user can close at the end
      }
      return ni;
    });
  }, [slides.length, persist]);

  const prev = useCallback(() => {
    setIndex((i) => {
      const ni = Math.max(i - 1, 0);
      persist({ lastIndex: ni });
      return ni;
    });
  }, [persist]);

  const goto = useCallback((i: number) => {
    const clamped = Math.min(Math.max(i, 0), slides.length - 1);
    setIndex(clamped);
    persist({ lastIndex: clamped });
  }, [slides.length, persist]);

  const value = useMemo(() => ({ open, index, slides, enabled: envEnabled, start, startIfFirstVisit, close, next, prev, goto }), [open, index, slides, envEnabled, start, startIfFirstVisit, close, next, prev, goto]);

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


