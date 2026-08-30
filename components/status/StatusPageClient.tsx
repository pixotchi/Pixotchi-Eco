"use client";

import { ThemeSelector } from "@/components/theme-selector";
import { Alert,AlertDescription,AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusService,StatusSnapshot } from "@/lib/status-checks";
import { AlertTriangle,RefreshCcw } from "lucide-react";
import Image from "next/image";
import { useCallback,useEffect,useRef,useState,useTransition } from "react";
import { StatusCard } from "./StatusCard";

interface StatusPageClientProps {
  initialSnapshot: StatusSnapshot;
  refreshMinutes: number;
  showManualRefresh: boolean;
}

export function StatusPageClient({ initialSnapshot, refreshMinutes, showManualRefresh }: StatusPageClientProps) {
  const [snapshot, setSnapshot] = useState<StatusSnapshot>(initialSnapshot);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const refreshInFlightRef = useRef(false);
  const lastRefreshAtRef = useRef(Date.now());

  const refresh = useCallback(() => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;

    startTransition(async () => {
      try {
        setError(null);
        const response = await fetch("/api/status/checks", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Failed to fetch latest status");
        }
        const data = (await response.json()) as StatusSnapshot;
        setSnapshot(data);
        lastRefreshAtRef.current = Date.now();
      } catch (err: UntypedValue) {
        setError(err?.message || "Unable to refresh status");
      } finally {
        refreshInFlightRef.current = false;
      }
    });
  }, []);

  useEffect(() => {
    if (!refreshMinutes || refreshMinutes <= 0) return;
    const ms = refreshMinutes * 60 * 1000;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const clearPolling = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const startPolling = () => {
      clearPolling();
      if (document.visibilityState !== "visible") return;
      intervalId = setInterval(refresh, ms);
    };

    const refreshAfterResume = () => {
      if (document.visibilityState !== "visible") {
        clearPolling();
        return;
      }

      // Avoid bursts when focus, visibility and pageshow fire together.
      if (Date.now() - lastRefreshAtRef.current >= 15_000) {
        refresh();
      }
      startPolling();
    };

    startPolling();
    document.addEventListener("visibilitychange", refreshAfterResume);
    window.addEventListener("focus", refreshAfterResume);
    window.addEventListener("online", refreshAfterResume);
    window.addEventListener("pageshow", refreshAfterResume);

    return () => {
      clearPolling();
      document.removeEventListener("visibilitychange", refreshAfterResume);
      window.removeEventListener("focus", refreshAfterResume);
      window.removeEventListener("online", refreshAfterResume);
      window.removeEventListener("pageshow", refreshAfterResume);
    };
  }, [refreshMinutes, refresh]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverscroll = html.style.overscrollBehavior;
    const prevBodyOverscroll = body.style.overscrollBehavior;

    html.style.overflow = "auto";
    body.style.overflow = "auto";
    html.style.overscrollBehavior = "auto";
    body.style.overscrollBehavior = "auto";

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      html.style.overscrollBehavior = prevHtmlOverscroll;
      body.style.overscrollBehavior = prevBodyOverscroll;
    };
  }, []);

  return (
    <div className="min-h-dvh bg-background bg-[image:var(--gradient-content-well)] text-foreground">
      <header className="sticky top-0 z-[var(--z-sticky)] overflow-hidden rounded-b-[var(--radius-panel)] border-x border-b border-x-[hsl(var(--border-strong)/0.28)] border-b-[hsl(var(--divider)/0.66)] bg-secondary/90 bg-[image:var(--gradient-app-chrome)] shadow-[var(--shadow-hairline)] backdrop-blur-md supports-[backdrop-filter]:bg-secondary/75">
        <div className="safe-area-top mx-auto flex w-full max-w-5xl items-start justify-between gap-3 px-4 pb-3 pt-3 sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Image src="/PixotchiKit/Logonotext.svg" alt="Pixotchi logo" width={28} height={28} preload />
            <div className="min-w-0">
              <p className="font-pixel text-base leading-tight tracking-wide text-foreground">PIXOTCHI STATUS</p>
              <p className="text-xs font-medium leading-tight text-muted-foreground">Live ecosystem health</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <div className="flex shrink-0 items-center gap-2">
              <ThemeSelector enableSecretGardenProgress={false} showMusicToggle={false} />
              {showManualRefresh && (
                <Button
                  onClick={refresh}
                  disabled={isPending}
                  variant="statusAction"
                  size="touchCompact"
                  className="gap-2"
                  aria-label={isPending ? "Refreshing system status" : "Refresh system status"}
                >
                  <RefreshCcw className={isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                  <span className="hidden sm:inline">{isPending ? "Refreshing" : "Refresh"}</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5 pb-[max(4rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom),var(--browser-safe-area-bottom))] sm:gap-5 sm:py-8">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>Refresh failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <section>
          <div className="grid gap-3 md:grid-cols-2">
          {snapshot.services.map((service: StatusService) => (
            <StatusCard key={service.id} service={service} />
          ))}
          </div>
        </section>
      </main>
    </div>
  );
}
