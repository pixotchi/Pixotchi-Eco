'use client';

import { beginAuthRecovery, SIGNED_OUT_QUERY_PARAM } from '@/lib/auth-cleanup';
import { clearAuthCaches } from '@/lib/cache-utils';
import { clearDisconnectedChatSession } from '@/lib/disconnect-wallet-identity';
import { sessionStorageManager } from '@/lib/session-storage-manager';

/** Old SDK promises cannot mutate a wallet established in the next document. */
export async function reloadWalletSession(connectAfterReload: boolean) {
  const release = beginAuthRecovery();
  if (!release) return;
  try {
    await sessionStorageManager.clearAuthState();
    await clearAuthCaches();
    await clearDisconnectedChatSession();
    const url = new URL(window.location.href);
    url.searchParams.delete('surface');
    if (connectAfterReload) url.searchParams.delete(SIGNED_OUT_QUERY_PARAM);
    else url.searchParams.set(SIGNED_OUT_QUERY_PARAM, 'signedout');
    window.location.replace(url.toString());
    // Keep the old document fenced until navigation has actually replaced it.
  } catch (error) {
    release();
    throw error;
  }
}
