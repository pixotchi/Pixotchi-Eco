"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const PERFORMANCE_MODE_STORAGE_KEY = "pixotchi:performance-mode";
const PERFORMANCE_MODE_EVENT = "pixotchi:performance-mode-change";

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

export function setPerformanceModePreference(enabled: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PERFORMANCE_MODE_STORAGE_KEY, enabled ? "1" : "0");
  applyPerformanceMode(enabled);
  window.dispatchEvent(new CustomEvent(PERFORMANCE_MODE_EVENT, { detail: enabled }));
}

export function usePerformanceMode() {
  const [enabled, setEnabled] = useState(false);
  const enabledRef = useRef(false);

  useEffect(() => {
    const initialPreference = readPerformanceModePreference();
    enabledRef.current = initialPreference;
    setEnabled(initialPreference);
    applyPerformanceMode(initialPreference);

    const handleStorage = (event: StorageEvent) => {
      if (event.key === PERFORMANCE_MODE_STORAGE_KEY) {
        const next = event.newValue === "1";
        enabledRef.current = next;
        setEnabled(next);
        applyPerformanceMode(next);
      }
    };

    const handlePreferenceChange = (event: Event) => {
      const next = event instanceof CustomEvent
        ? Boolean(event.detail)
        : readPerformanceModePreference();
      enabledRef.current = next;
      setEnabled(next);
      applyPerformanceMode(next);
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(PERFORMANCE_MODE_EVENT, handlePreferenceChange);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(PERFORMANCE_MODE_EVENT, handlePreferenceChange);
    };
  }, []);

  const updateEnabled = useCallback((next: boolean | ((previous: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(enabledRef.current) : next;
    enabledRef.current = resolved;
    setEnabled(resolved);
    setPerformanceModePreference(resolved);
  }, []);

  return {
    enabled,
    setEnabled: updateEnabled,
  };
}

export function PerformanceModeController() {
  useEffect(() => {
    applyPerformanceMode(readPerformanceModePreference());

    const handleStorage = (event: StorageEvent) => {
      if (event.key === PERFORMANCE_MODE_STORAGE_KEY) {
        applyPerformanceMode(event.newValue === "1");
      }
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return null;
}
