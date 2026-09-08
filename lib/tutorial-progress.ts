export type TutorialMode = "quick" | "full";
export type TutorialProgress = {
  mode: TutorialMode;
  lastIndex: number;
  completed: boolean;
  skipped: boolean;
};

export function clampTutorialIndex(value: unknown, count: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(0, Math.floor(value)), Math.max(0, count - 1))
    : 0;
}

/** Corrupt/legacy storage never hides the dialog behind an invalid slide. */
export function readTutorialProgress(
  raw: string | null,
  quickCount: number,
  fullCount: number,
): TutorialProgress | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const data = value as Record<string, unknown>;
    const mode = data.mode === "full" ? "full" : "quick";
    return {
      mode,
      lastIndex: clampTutorialIndex(
        data.lastIndex,
        mode === "quick" ? quickCount : fullCount,
      ),
      completed: data.completed === true,
      skipped: data.skipped === true,
    };
  } catch {
    return null;
  }
}
