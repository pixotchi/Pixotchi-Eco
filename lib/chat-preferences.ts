import type { ChatMode } from "./types";

const CHAT_MODE_KEY = "chat-mode";
const CHAT_LAST_READ_KEY = "chat-last-read";

/**
 * Guarded chat preference storage, in the image of lib/quest-preferences.ts.
 *
 * These reads/writes used to be bare `localStorage` calls inside ChatProvider
 * effects. Storage throws outright in Safari Private Browsing and in
 * storage-partitioned webviews, and a throw in an effect propagates to the
 * nearest boundary — which for ChatProvider is the one wrapping the entire
 * provider tower. A blocked storage API took the whole game down instead of
 * degrading to a non-persisted chat.
 */
export function loadChatMode(fallback: ChatMode): ChatMode {
  if (typeof window === "undefined") return fallback;

  try {
    const stored = window.localStorage.getItem(CHAT_MODE_KEY);
    return stored === "public" || stored === "ai" ? (stored as ChatMode) : fallback;
  } catch {
    return fallback;
  }
}

export function storeChatMode(mode: ChatMode): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(CHAT_MODE_KEY, mode);
  } catch {
    // Storage unavailable - the in-memory mode still works for this session.
  }
}

export function loadChatLastRead(): number {
  if (typeof window === "undefined") return Date.now();

  try {
    const stored = window.localStorage.getItem(CHAT_LAST_READ_KEY);
    if (stored === null) return Date.now();

    const parsed = Number.parseInt(stored, 10);
    // A non-finite value would make every `message.timestamp > lastRead`
    // comparison false and pin the unread badge at 0 forever.
    return Number.isFinite(parsed) ? parsed : Date.now();
  } catch {
    return Date.now();
  }
}

export function storeChatLastRead(timestamp: number): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(CHAT_LAST_READ_KEY, String(timestamp));
  } catch {
    // Storage unavailable - unread tracking is best-effort.
  }
}
