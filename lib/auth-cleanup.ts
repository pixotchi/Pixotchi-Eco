'use client';

import { useSyncExternalStore } from 'react';

let pending = false;
let recoveryPending = false;
let stalled = false;
let stallTimer: ReturnType<typeof setTimeout> | undefined;
export const AUTH_CLEANUP_STALL_MS = 15_000;
export const SIGNED_OUT_QUERY_PARAM = 'walletSession';
const initiallySignedOut = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get(SIGNED_OUT_QUERY_PARAM) === 'signedout';
let reconnectAllowed = !initiallySignedOut;
let generation = 0;
export const getAuthGeneration = () => generation;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const isAuthCleanupPending = () => pending || recoveryPending;
export const subscribeToAuthCleanup = subscribe;
export const useAuthCleanupPending = () => useSyncExternalStore(subscribe, isAuthCleanupPending, () => false);
export const isAuthCleanupStalled = () => stalled;
export const useAuthCleanupStalled = () => useSyncExternalStore(subscribe, isAuthCleanupStalled, () => false);
export const needsFreshWalletDocument = () => generation > 0 || initiallySignedOut;
export const isWalletReconnectAllowed = () => reconnectAllowed && !isAuthCleanupPending();
export const useWalletReconnectAllowed = () => useSyncExternalStore(subscribe, isWalletReconnectAllowed, () => true);

/** Only an explicit connection action can end the current document's sign-out intent. */
export function allowWalletReconnect() {
  if (isAuthCleanupPending()) return false;
  reconnectAllowed = true;
  listeners.forEach(listener => listener());
  return true;
}

/** Acquired synchronously before logout exposes a disconnected render. */
export function beginAuthCleanup(): (() => void) | null {
  if (isAuthCleanupPending()) return null;
  pending = true;
  reconnectAllowed = false;
  stalled = false;
  stallTimer = setTimeout(() => {
    if (!pending) return;
    stalled = true;
    listeners.forEach(listener => listener());
  }, AUTH_CLEANUP_STALL_MS);
  generation += 1;
  listeners.forEach(listener => listener());
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pending = false;
    clearTimeout(stallTimer);
    if (!recoveryPending) stalled = false;
    listeners.forEach(listener => listener());
  };
}

/** A requested document reset keeps the fence even if the old SDK settles meanwhile. */
export function beginAuthRecovery(): (() => void) | null {
  if (recoveryPending) return null;
  recoveryPending = true;
  reconnectAllowed = false;
  generation += 1;
  listeners.forEach(listener => listener());
  return () => {
    recoveryPending = false;
    if (!pending) stalled = false;
    listeners.forEach(listener => listener());
  };
}
