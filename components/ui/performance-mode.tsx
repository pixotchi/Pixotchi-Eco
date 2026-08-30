"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

const PERFORMANCE_MODE_STORAGE_KEY = "pixotchi:performance-mode";
const PERFORMANCE_MODE_EVENT = "pixotchi:performance-mode-change";

/*
 * One module-level store. usePerformanceMode used to be four independent
 * copies of the same boolean (snow context, ambient audio, wallet profile and
 * the controller), each with its own localStorage read, listener pair and
 * applyPerformanceMode DOM write on every change.
 */
let currentEnabled = false;
let initialized = false;
const subscribers = new Set<() => void>();

function readPerformanceModePreference() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(PERFORMANCE_MODE_STORAGE_KEY) === "1";
}

function applyPerformanceMode(enabled: boolean) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.toggle("performance-mode", enabled);
  if (enabled) {
    document.documentElement.dataset.performanceMode = "enabled";
  } else {
    delete document.documentElement.dataset.performanceMode;
  }
}

function setStoreValue(next: boolean) {
  if (currentEnabled === next && initialized) return;
  currentEnabled = next;
  initialized = true;
  applyPerformanceMode(next);
  subscribers.forEach((subscriber) => subscriber());
}

function ensureInitialized() {
  if (!initialized && typeof window !== "undefined") {
    setStoreValue(readPerformanceModePreference());
  }
}

function subscribe(callback: () => void) {
  ensureInitialized();
  subscribers.add(callback);

  if (subscribers.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
    window.addEventListener(PERFORMANCE_MODE_EVENT, handlePreferenceChange);
  }

  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(PERFORMANCE_MODE_EVENT, handlePreferenceChange);
    }
  };
}

function handleStorage(event: StorageEvent) {
  if (event.key === PERFORMANCE_MODE_STORAGE_KEY) {
    setStoreValue(event.newValue === "1");
  }
}

function handlePreferenceChange(event: Event) {
  const next = event instanceof CustomEvent
    ? Boolean(event.detail)
    : readPerformanceModePreference();
  setStoreValue(next);
}

export function setPerformanceModePreference(enabled: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PERFORMANCE_MODE_STORAGE_KEY, enabled ? "1" : "0");
  setStoreValue(enabled);
  window.dispatchEvent(new CustomEvent(PERFORMANCE_MODE_EVENT, { detail: enabled }));
}

export function usePerformanceMode() {
  const enabled = useSyncExternalStore(
    subscribe,
    // Pure snapshot: initialization (which writes the DOM class) happens in
    // subscribe, never during render.
    () => (initialized ? currentEnabled : readPerformanceModePreference()),
    () => false,
  );

  const updateEnabled = useCallback((next: boolean | ((previous: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(currentEnabled) : next;
    setPerformanceModePreference(resolved);
  }, []);

  return {
    enabled,
    setEnabled: updateEnabled,
  };
}

/** Applies the persisted preference on boot (before any consumer mounts). */
export function PerformanceModeController() {
  useEffect(() => {
    ensureInitialized();
  }, []);

  return null;
}
