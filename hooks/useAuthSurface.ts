"use client";

import { useEffect, useState } from "react";
import { AUTH_SURFACE_CHANGE_EVENT, sessionStorageManager } from "@/lib/session-storage-manager";

type EffectiveAuthSurface = "privy" | "base" | "privysolana" | null;

export function useAuthSurface() {
  const [surface, setSurface] = useState<EffectiveAuthSurface>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    const syncSurface = () => {
      setSurface(sessionStorageManager.getEffectiveAuthSurface());
      setResolved(true);
    };

    syncSurface();

    const handleSurfaceChange = (event: Event) => {
      const detail = (event as CustomEvent<{ surface?: EffectiveAuthSurface }>).detail;
      setSurface(detail?.surface ?? sessionStorageManager.getEffectiveAuthSurface());
      setResolved(true);
    };

    window.addEventListener(AUTH_SURFACE_CHANGE_EVENT, handleSurfaceChange as EventListener);
    return () => {
      window.removeEventListener(AUTH_SURFACE_CHANGE_EVENT, handleSurfaceChange as EventListener);
    };
  }, []);

  return { resolved, surface } as const;
}
