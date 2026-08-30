"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}

/**
 * Whether the document is currently visible. Used to gate RPC pollers that
 * otherwise keep hammering the endpoint while the webview is backgrounded or
 * the phone is locked (in-app tab visibility does not cover that case).
 */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.visibilityState === "visible",
    () => true,
  );
}
