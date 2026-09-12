"use client";

import { useSyncExternalStore } from "react";

type Preferences = { haptics: boolean };
const defaults: Preferences = { haptics: false };
let preferences = defaults;
let initialized = false;
const listeners = new Set<() => void>();
const key = "pixotchi:sensory-feedback";

function isPerformanceModeEnabled() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("performance-mode");
}

function readPreferences() {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) || "{}");
    if (saved && typeof saved === "object") {
      const haptics = "haptics" in saved && saved.haptics === true;
      preferences = { haptics: haptics && !isPerformanceModeEnabled() };
      if (haptics && !preferences.haptics) {
        localStorage.setItem(key, JSON.stringify(preferences));
      }
    }
  } catch {
    /* Restricted storage keeps the session preference. */
  }
}
function onStorage(event: StorageEvent) {
  if (event.key !== key) return;
  preferences = defaults;
  readPreferences();
  listeners.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  if (!initialized) {
    initialized = true;
    readPreferences();
  }
  listeners.add(fn);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}
export function useSensoryPreferences() {
  return useSyncExternalStore(
    subscribe,
    () => preferences,
    () => defaults,
  );
}
export function setSensoryPreference(
  name: keyof Preferences,
  enabled: boolean,
) {
  initialized = true;
  preferences = { ...preferences, [name]: enabled && !isPerformanceModeEnabled() };
  try {
    localStorage.setItem(key, JSON.stringify(preferences));
  } catch {
    /* Session only. */
  }
  listeners.forEach((fn) => fn());
}

let lastHaptic = 0;
const patterns = { light: 10, medium: 25, success: [15, 40, 25] };
export function haptic(kind: keyof typeof patterns) {
  if (
    typeof document === "undefined" ||
    document.hidden ||
    isPerformanceModeEnabled() ||
    !preferences.haptics ||
    !navigator.vibrate
  )
    return;
  const now = performance.now();
  if (now - lastHaptic < 60) return;
  lastHaptic = now;
  try {
    navigator.vibrate(patterns[kind]);
  } catch {
    /* Unsupported webviews are silent. */
  }
}
