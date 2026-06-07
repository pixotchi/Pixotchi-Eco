"use client";

import { ThemeSelector } from "@/components/theme-selector";
import { Alert,AlertDescription,AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusService,StatusSnapshot } from "@/lib/status-checks";
import { AlertTriangle,Clock3,RefreshCcw,Server } from "lucide-react";
import Image from "next/image";
import { useCallback,useEffect,useState,useTransition } from "react";
import { StatusCard } from "./StatusCard";
import { StatusBadge } from "./StatusBadge";

interface StatusPageClientProps {
  initialSnapshot: StatusSnapshot;
  refreshMinutes: number;
  showManualRefresh: boolean;
}

export function StatusPageClient({ initialSnapshot, refreshMinutes, showManualRefresh }: StatusPageClientProps) {
  const [snapshot, setSnapshot] = useState<StatusSnapshot>(initialSnapshot);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const operationalCount = snapshot.services.filter((service) => service.status === "operational").length;
  const issueCount = snapshot.services.length - operationalCount;
  const formattedUpdatedAt = new Date(snapshot.generatedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

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
      } catch (err: UntypedValue) {
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

  return (
    <div className="min-h-dvh bg-background bg-[image:var(--gradient-content-well)] text-foreground">
      <header className="sticky top-0 z-[var(--z-sticky)] overflow-hidden rounded-b-[var(--radius-panel)] border-x border-b border-x-[hsl(var(--border-strong)/0.28)] border-b-[hsl(var(--divider)/0.66)] bg-secondary/90 bg-[image:var(--gradient-app-chrome)] shadow-[var(--shadow-hairline)] backdrop-blur-md supports-[backdrop-filter]:bg-secondary/75">
        <div className="safe-area-top mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 pb-3 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Image src="/PixotchiKit/Logonotext.svg" alt="Pixotchi logo" width={28} height={28} priority />
            <div className="min-w-0">
              <p className="font-pixel text-base leading-tight tracking-wide text-foreground">PIXOTCHI STATUS</p>
              <p className="text-xs font-medium leading-tight text-muted-foreground">Live ecosystem health</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
            <div className="flex items-center gap-2">
              <ThemeSelector />
              {showManualRefresh && (
                <Button onClick={refresh} disabled={isPending} variant="statusAction" size="status" className="gap-2">
                  <RefreshCcw className={isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                  <span>{isPending ? "Refreshing" : "Refresh"}</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5 pb-[max(4rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom),var(--browser-safe-area-bottom))] sm:gap-5 sm:py-8">
        <section className="rounded-[var(--radius-panel)] border border-[hsl(var(--border-strong)/0.34)] bg-card/95 bg-[image:var(--gradient-surface)] p-4 shadow-[var(--shadow-raised)] backdrop-blur-[var(--blur-surface)] sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold leading-tight text-foreground sm:text-2xl">System status</h1>
                <StatusBadge status={snapshot.overall} />
              </div>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Real-time health checks for the Pixotchi app, Base network dependencies, indexer, notifications, database, and RPC cluster.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 rounded-[var(--radius-control)] border border-border/60 bg-background/50 px-3 py-2 text-xs text-muted-foreground shadow-[var(--shadow-hairline)]">
              <Clock3 className="h-4 w-4 text-primary" aria-hidden="true" />
              <span className="leading-tight">
                Updated <span className="font-semibold text-foreground">{formattedUpdatedAt}</span>
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="chromatic-white-surface rounded-[var(--radius-control)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-hairline)]">
              <p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">Operational</p>
              <p className="mt-1 text-lg font-semibold leading-none tabular-nums text-foreground">
                {operationalCount}/{snapshot.services.length}
              </p>
            </div>
            <div className="chromatic-white-surface rounded-[var(--radius-control)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-hairline)]">
              <p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">Signals needing attention</p>
              <p className="mt-1 text-lg font-semibold leading-none tabular-nums text-foreground">{issueCount}</p>
            </div>
            <div className="chromatic-white-surface rounded-[var(--radius-control)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-hairline)]">
              <p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">Refresh cadence</p>
              <p className="mt-1 text-lg font-semibold leading-none tabular-nums text-foreground">{refreshMinutes || 15} min</p>
            </div>
          </div>
        </section>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>Refresh failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <section className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Server className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-semibold leading-tight text-foreground">Service checks</h2>
          </div>
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
