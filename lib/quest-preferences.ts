import { isQuestDifficultyId, type QuestDifficultyId } from "./contracts";

const BATCH_QUEST_DIFFICULTY_KEY = "pixotchi:quest:batch-difficulty";

/**
 * Hard is the default: its reward multiplier is 3x, and `finalizeQuest` resets
 * `quest.difficulty` to EASY before reading the cooldown, so every difficulty
 * ends up on the same 12h cooldown. That makes Hard the best reward-per-cycle
 * choice, so it is the sensible thing to preselect.
 */
export const DEFAULT_BATCH_QUEST_DIFFICULTY: QuestDifficultyId = 2;

export function loadBatchQuestDifficulty(): QuestDifficultyId {
  if (typeof window === "undefined") return DEFAULT_BATCH_QUEST_DIFFICULTY;

  try {
    const stored = window.localStorage.getItem(BATCH_QUEST_DIFFICULTY_KEY);
    if (stored === null) return DEFAULT_BATCH_QUEST_DIFFICULTY;

    const parsed = Number.parseInt(stored, 10);
    return isQuestDifficultyId(parsed) ? parsed : DEFAULT_BATCH_QUEST_DIFFICULTY;
  } catch {
    return DEFAULT_BATCH_QUEST_DIFFICULTY;
  }
}

export function storeBatchQuestDifficulty(difficulty: QuestDifficultyId): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(BATCH_QUEST_DIFFICULTY_KEY, String(difficulty));
  } catch {
    // Storage can be unavailable (private mode, blocked site data) - the
    // in-memory selection still works for this session.
  }
}
