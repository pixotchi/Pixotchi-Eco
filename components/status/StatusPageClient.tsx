"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { StatusSnapshot, StatusService, StatusLevel } from "@/lib/status-checks";
import { StatusBadge } from "./StatusBadge";
import { StatusCard } from "./StatusCard";
import { Button } from "@/components/ui/button";
import { RefreshCcw } from "lucide-react";
import { ThemeSelector } from "@/components/theme-selector";
import Image from "next/image";

interface StatusPageClientProps {
  initialSnapshot: StatusSnapshot;
  refreshMinutes: number;
  showManualRefresh: boolean;
}

const statusCopy: Record<StatusLevel, { headline: string; description: string }> = {
  operational: {
    headline: "All systems operational",
    description: "Everything looks healthy across Pixotchi services.",
  },
  degraded: {
    headline: "Performance degraded",
    description: "Some systems are experiencing slowdowns. Our team is monitoring.",
  },
  outage: {
    headline: "Service disruption detected",
    description: "One or more systems are unavailable. Check details below.",
  },
  unknown: {
    headline: "Status unknown",
    description: "We couldn’t determine the current state. Please try refreshing.",
  },
};

export function StatusPageClient({ initialSnapshot, refreshMinutes, showManualRefresh }: StatusPageClientProps) {
  const [snapshot, setSnapshot] = useState<StatusSnapshot>(initialSnapshot);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    startTransition(async () => {
      try {
        setError(null);
        const response = await fetch("/api/status/checks", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Failed to fetch latest status");
        }
        const data = (await response.json()) as StatusSnapshot;
        setSnapshot(data);
      } catch (err: any) {
        setError(err?.message || "Unable to refresh status");
      }
    });
  }, []);

  useEffect(() => {
    if (!refreshMinutes || refreshMinutes <= 0) return;
    const ms = refreshMinutes * 60 * 1000;
    const id = setInterval(() => {
      refresh();
    }, ms);
    return () => clearInterval(id);
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

  const summary = useMemo(() => statusCopy[snapshot.overall] ?? statusCopy.unknown, [snapshot.overall]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-background/90 text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-card/90 px-4 py-3 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Image src="/PixotchiKit/Logonotext.svg" alt="Pixotchi logo" width={28} height={28} priority />
            <p className="font-pixel text-base tracking-wide text-foreground">PIXOTCHI STATUS</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
            <div className="text-left text-sm text-muted-foreground sm:text-right">
              <span className="block">Last updated</span>
              <span className="font-medium text-foreground">
                {new Date(snapshot.generatedAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
              <span className="block text-xs">Auto-refresh: every {refreshMinutes || 15} min</span>
            </div>
            <div className="flex items-center gap-3">
              <ThemeSelector />
              {showManualRefresh && (
                <Button onClick={refresh} disabled={isPending} variant="outline" className="gap-2">
                  <RefreshCcw className={isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                  Refresh
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-12 pb-24">
        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
        )}

        <section className="grid gap-4 md:grid-cols-2">
          {snapshot.services.map((service: StatusService) => (
            <StatusCard key={service.id} service={service} />
          ))}
        </section>
      </main>
    </div>
  );
}

