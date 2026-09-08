'use client';

import { useSyncExternalStore } from 'react';

const subscribers = new Set<() => void>();
let value = 0;
let timer: ReturnType<typeof setInterval> | null = null;
function update() { value += 1; subscribers.forEach(listener => listener()); }
function reconcileVisibility() {
  if (timer) clearInterval(timer);
  timer = null;
  if (document.visibilityState === 'visible') { update(); timer = setInterval(update, 30_000); }
}
function subscribe(listener: () => void) {
  subscribers.add(listener);
  if (subscribers.size === 1) {
    document.addEventListener('visibilitychange', reconcileVisibility);
    reconcileVisibility();
  }
  return () => {
    subscribers.delete(listener);
    if (!subscribers.size) {
      if (timer) clearInterval(timer);
      timer = null;
      document.removeEventListener('visibilitychange', reconcileVisibility);
    }
  };
}
/** A visible, mounted relative-time surface shares one thirty-second clock. */
export function useRelativeTimeTick() { return useSyncExternalStore(subscribe, () => value, () => 0); }
