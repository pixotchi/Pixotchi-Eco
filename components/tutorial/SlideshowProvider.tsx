"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  QUICK_START_SLIDE_IDS,
  TASKS_TUTORIAL_SLIDE_ID,
  TUTORIAL_SLIDE_IDS,
  TUTORIAL_VERSION,
  type TutorialSlideId,
} from "./config";
import { getClientGamificationPolicy } from "@/lib/gamification-client";
import {
  clampTutorialIndex,
  readTutorialProgress,
  type TutorialMode,
  type TutorialProgress,
} from "@/lib/tutorial-progress";

type SlideshowContextType = {
  open: boolean;
  index: number;
  mode: TutorialMode;
  slideIds: readonly TutorialSlideId[];
  enabled: boolean;
  start: (opts?: { reset?: boolean }) => void;
  startIfFirstVisit: () => void;
  close: () => void;
  finish: () => void;
  next: () => void;
  prev: () => void;
  goto: (i: number) => void;
};
const SlideshowContext = createContext<SlideshowContextType | null>(null);
const STORAGE_KEY = "pixotchi:tutorial";

export function SlideshowProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<TutorialMode>("quick");
  const policy = getClientGamificationPolicy();
  const fullIds = useMemo(
    () =>
      policy.visible && policy.enabled
        ? TUTORIAL_SLIDE_IDS
        : TUTORIAL_SLIDE_IDS.filter((id) => id !== TASKS_TUTORIAL_SLIDE_ID),
    [policy.visible, policy.enabled],
  );
  const slideIds = mode === "quick" ? QUICK_START_SLIDE_IDS : fullIds;
  const envEnabled =
    (process.env.NEXT_PUBLIC_TUTORIAL_SLIDESHOW || "on") === "on";
  const read = useCallback(() => {
    try {
      return readTutorialProgress(
        localStorage.getItem(STORAGE_KEY),
        QUICK_START_SLIDE_IDS.length,
        fullIds.length,
      );
    } catch {
      return null;
    }
  }, [fullIds.length]);
  const persist = useCallback((progress: TutorialProgress) => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: TUTORIAL_VERSION, ...progress }),
      );
    } catch {
      /* The guide remains usable when storage is unavailable. */
    }
  }, []);

  const startIfFirstVisit = useCallback(() => {
    if (!envEnabled) return;
    const saved = read();
    if (saved?.completed || saved?.skipped) return;
    const nextMode = saved?.mode ?? "quick";
    const nextIndex = saved?.lastIndex ?? 0;
    setMode(nextMode);
    setIndex(nextIndex);
    setOpen(true);
    persist({
      mode: nextMode,
      lastIndex: nextIndex,
      completed: false,
      skipped: false,
    });
  }, [envEnabled, read, persist]);

  // Settings opens the full guide and resumes a previously paused full guide.
  const start = useCallback(
    (opts?: { reset?: boolean }) => {
      if (!envEnabled) return;
      const saved = read();
      const nextIndex =
        !opts?.reset && saved?.mode === "full" && !saved.completed
          ? saved.lastIndex
          : 0;
      setMode("full");
      setIndex(nextIndex);
      setOpen(true);
      persist({
        mode: "full",
        lastIndex: nextIndex,
        completed: false,
        skipped: false,
      });
    },
    [envEnabled, read, persist],
  );
  const close = useCallback(() => {
    setOpen(false);
    persist({ mode, lastIndex: index, completed: false, skipped: true });
  }, [index, mode, persist]);
  const finish = useCallback(() => {
    setOpen(false);
    persist({ mode, lastIndex: index, completed: true, skipped: false });
  }, [index, mode, persist]);
  const goto = useCallback(
    (value: number) => {
      const nextIndex = clampTutorialIndex(value, slideIds.length);
      setIndex(nextIndex);
      persist({ mode, lastIndex: nextIndex, completed: false, skipped: false });
    },
    [slideIds.length, mode, persist],
  );
  const next = useCallback(() => goto(index + 1), [goto, index]);
  const prev = useCallback(() => goto(index - 1), [goto, index]);
  const value = useMemo(
    () => ({
      open,
      index: clampTutorialIndex(index, slideIds.length),
      mode,
      slideIds,
      enabled: envEnabled,
      start,
      startIfFirstVisit,
      close,
      finish,
      next,
      prev,
      goto,
    }),
    [
      open,
      index,
      mode,
      slideIds,
      envEnabled,
      start,
      startIfFirstVisit,
      close,
      finish,
      next,
      prev,
      goto,
    ],
  );
  return (
    <SlideshowContext.Provider value={value}>
      {children}
    </SlideshowContext.Provider>
  );
}

export function useSlideshow() {
  const value = useContext(SlideshowContext);
  if (!value)
    throw new Error("useSlideshow must be used within SlideshowProvider");
  return value;
}
