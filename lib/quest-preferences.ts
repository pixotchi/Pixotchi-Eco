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

// ---------------------------------------------------------------------------
// Batch run tracking
// ---------------------------------------------------------------------------

const BATCH_QUEST_RUN_KEY = "pixotchi:quest:batch-run";

/**
 * How long a paid run stays open.
 *
 * A run is "send every farmer that is idle right now", which can take more than
 * one transaction when the fleet exceeds the per-bundle cap. The fee is charged
 * once for the whole run, so continuation bundles need to know a fee was already
 * paid. An hour is far longer than the seconds it takes to fire the follow-up
 * bundles, and far shorter than the >=15h quest cycle that produces the next
 * genuinely new batch of idle farmers.
 */
const BATCH_QUEST_RUN_WINDOW_MS = 60 * 60 * 1000;

type BatchQuestRun = {
  landIdsHash: string;
  paidAt: number;
  // The submitted transaction/user-op identity is retained so recovery can
  // distinguish a paid operation from a callback that never reached success.
  submissionIdentity?: string;
  // A submitted fee is deliberately not a paid fee. The card keeps its
  // identity durably so transaction-kit can recover it after a remount, while
  // continuation bundles remain blocked until a canonical receipt succeeds.
  submissionState?: "pending" | "confirmed";
};

function readRun(): BatchQuestRun | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(BATCH_QUEST_RUN_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as Partial<BatchQuestRun>;
    if (typeof parsed?.landIdsHash !== "string" || typeof parsed?.paidAt !== "number") {
      return null;
    }

    return {
      landIdsHash: parsed.landIdsHash,
      paidAt: parsed.paidAt,
      ...(typeof parsed.submissionIdentity === "string" && parsed.submissionIdentity.trim()
        ? { submissionIdentity: parsed.submissionIdentity }
        : {}),
      ...(parsed.submissionState === "pending" || parsed.submissionState === "confirmed"
        ? { submissionState: parsed.submissionState }
        : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Whether the flat fee has already been paid for the run currently in progress.
 *
 * Scoped by the caller to the wallet plus exact land set so a wallet/holdings
 * change starts a fresh run, and time-boxed so a half-finished run cannot hand
 * out free bundles tomorrow.
 */
export function isBatchQuestRunPaid(landIdsHash: string, now: number = Date.now()): boolean {
  const run = readRun();
  if (!run || run.landIdsHash !== landIdsHash) return false;

  const age = now - run.paidAt;
  // A clock that jumped backwards would otherwise keep a run open indefinitely.
  if (age < 0 || age >= BATCH_QUEST_RUN_WINDOW_MS) return false;

  // Legacy markers predate the explicit state field and represented a completed
  // run. New submissions always write `pending` and cannot unlock a free
  // continuation until their canonical success callback upgrades them.
  return run.submissionState !== "pending";
}

export function isBatchQuestRunPending(landIdsHash: string, now: number = Date.now()): boolean {
  const run = readRun();
  if (!run || run.landIdsHash !== landIdsHash) return false;

  const age = now - run.paidAt;
  return age >= 0 && age < BATCH_QUEST_RUN_WINDOW_MS && run.submissionState === "pending";
}

/**
 * Return the submitted operation identity for the live run. Keeping this
 * alongside the paid bit lets a remounted card revoke the fee exemption if its
 * original transaction later receives a canonical revert status.
 */
export function getBatchQuestRunSubmissionIdentity(
  landIdsHash: string,
  now: number = Date.now(),
): string | undefined {
  const run = readRun();
  if (!run || run.landIdsHash !== landIdsHash) return undefined;

  const age = now - run.paidAt;
  if (age < 0 || age >= BATCH_QUEST_RUN_WINDOW_MS) return undefined;

  return run.submissionIdentity;
}

export function markBatchQuestRunPaid(
  landIdsHash: string,
  now: number = Date.now(),
  submissionIdentity?: string,
): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      BATCH_QUEST_RUN_KEY,
      JSON.stringify({
        landIdsHash,
        paidAt: now,
        ...(submissionIdentity?.trim() ? { submissionIdentity: submissionIdentity.trim() } : {}),
        submissionState: "confirmed",
      } satisfies BatchQuestRun),
    );
  } catch {
    // Storage unavailable. The run still completes; the worst case is that a
    // continuation bundle charges the fee a second time, so this is only ever
    // best-effort.
  }
}

/** Record a submitted fee without granting its continuation exemption yet. */
export function markBatchQuestRunPending(
  landIdsHash: string,
  now: number = Date.now(),
  submissionIdentity?: string,
): void {
  if (typeof window === "undefined" || !submissionIdentity?.trim()) return;

  try {
    window.localStorage.setItem(
      BATCH_QUEST_RUN_KEY,
      JSON.stringify({
        landIdsHash,
        paidAt: now,
        submissionIdentity: submissionIdentity.trim(),
        submissionState: "pending",
      } satisfies BatchQuestRun),
    );
  } catch {
    // Without durable storage transaction-kit also refuses submission, so this
    // cannot silently become a free continuation.
  }
}

export function clearBatchQuestRun(): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(BATCH_QUEST_RUN_KEY);
  } catch {
    // Nothing to do; an orphaned marker expires on its own.
  }
}
