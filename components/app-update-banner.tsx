"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Info } from "lucide-react";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { CLIENT_ENV } from "@/lib/env-config";
import { cn } from "@/lib/utils";

type VersionPayload = {
  buildId?: string;
  version?: string;
};

const CURRENT_BUILD_ID = CLIENT_ENV.APP_BUILD_ID;
const UPDATE_CHECK_INTERVAL_MS = Math.max(
  60_000,
  CLIENT_ENV.APP_UPDATE_CHECK_INTERVAL_SECONDS * 1000,
);

export function AppUpdateBanner({ disabled = false }: { disabled?: boolean }) {
  const pathname = usePathname();
  const isStatusRoute = pathname === "/status" || pathname.startsWith("/status/");
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const checkingRef = useRef(false);

  const checkForUpdate = useCallback(async () => {
    if (
      disabled ||
      isStatusRoute ||
      updateAvailable ||
      typeof window === "undefined" ||
      document.visibilityState === "hidden" ||
      checkingRef.current
    ) {
      return;
    }

    checkingRef.current = true;

    try {
      const response = await fetch(`/api/version?ts=${Date.now()}`, {
        cache: "no-store",
        headers: {
          "cache-control": "no-cache",
        },
      });

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as VersionPayload;
      const latestBuildId = data.buildId?.trim();

      if (!latestBuildId || !CURRENT_BUILD_ID) {
        return;
      }

      if (latestBuildId !== CURRENT_BUILD_ID) {
        setUpdateAvailable(true);
      }
    } catch {
      // Silent retry on the next focus/poll cycle.
    } finally {
      checkingRef.current = false;
    }
  }, [disabled, isStatusRoute, updateAvailable]);

  useEffect(() => {
    if (disabled || isStatusRoute || typeof window === "undefined") {
      return;
    }

    void checkForUpdate();

    const handleVisibleCheck = () => {
      if (document.visibilityState === "visible") {
        void checkForUpdate();
      }
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void checkForUpdate();
      }
    }, UPDATE_CHECK_INTERVAL_MS);

    window.addEventListener("focus", handleVisibleCheck);
    window.addEventListener("online", handleVisibleCheck);
    window.addEventListener("pageshow", handleVisibleCheck);
    document.addEventListener("visibilitychange", handleVisibleCheck);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisibleCheck);
      window.removeEventListener("online", handleVisibleCheck);
      window.removeEventListener("pageshow", handleVisibleCheck);
      document.removeEventListener("visibilitychange", handleVisibleCheck);
    };
  }, [checkForUpdate, disabled, isStatusRoute]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);

    try {
      window.location.reload();
    } catch {
      window.location.replace(window.location.href);
    }
  }, []);

  if (!updateAvailable || disabled || isStatusRoute) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed left-1/2 top-[calc(max(0.75rem,env(safe-area-inset-top),var(--safe-area-inset-top),var(--browser-safe-area-top))+4.75rem)] z-[var(--z-overlay)] w-[calc(100%-1rem)] max-w-md -translate-x-1/2 px-2">
      <div className="pointer-events-auto flex items-center gap-3 rounded-[var(--radius-panel)] border border-[hsl(var(--border-strong)/0.38)] bg-card/95 bg-[image:var(--gradient-surface)] px-3 py-2 shadow-[var(--shadow-raised)] backdrop-blur-[var(--blur-surface)] supports-[backdrop-filter]:bg-card/90">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <div className="mt-0.5 rounded-full bg-primary/10 p-1">
            <Info className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium leading-none text-foreground">Update available</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Refresh to load the latest build.
            </p>
          </div>
        </div>
        <Button size="xs" onClick={handleRefresh} disabled={refreshing} className="shrink-0">
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </Button>
      </div>
    </div>
  );
}
