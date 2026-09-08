'use client';

import { beginAuthCleanup } from './auth-cleanup';
import { clearAuthCaches } from './cache-utils';
import { clearPublicChatSession } from './chat-auth-client';
import { sessionStorageManager } from './session-storage-manager';

const CHAT_CLEANUP_TIMEOUT_MS = 10_000;

export async function clearDisconnectedChatSession(signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), CHAT_CLEANUP_TIMEOUT_MS);
  try { await clearPublicChatSession(controller.signal); }
  catch (error) { console.warn('Failed to clear disconnected chat session:', error); }
  finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}

/** One disconnect owns cleanup until it settles; a later identity cannot overlap it. */
export async function disconnectWalletIdentity({ onStart, logout, disconnect, onLogoutError }: {
  onStart: () => void;
  logout?: () => Promise<void>;
  disconnect?: () => Promise<void>;
  onLogoutError?: (error: unknown) => void;
}): Promise<boolean | null> {
  const finish = beginAuthCleanup();
  if (!finish) return null;
  try {
    onStart();
    await sessionStorageManager.markPrivyLogoutIntent();
    let logoutSucceeded = true;
    if (logout) {
      try { await logout(); }
      catch (error) { logoutSucceeded = false; onLogoutError?.(error); }
    }
    // Wagmi's mutate() returns before the connector has finished. Require its
    // promise so reconnect stays locked and a rejection cannot report success.
    let disconnectFailure: { error: unknown } | null = null;
    try { await disconnect?.(); }
    catch (error) { disconnectFailure = { error }; }
    await sessionStorageManager.clearAuthState();
    // Clear local identity before awaiting remote work. Never run another SDK
    // storage sweep after that work has completed or timed out.
    await clearAuthCaches();
    await clearDisconnectedChatSession();
    if (disconnectFailure) throw disconnectFailure.error;
    return logoutSucceeded;
  } finally { finish(); }
}
