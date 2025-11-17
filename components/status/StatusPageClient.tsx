"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { StatusSnapshot, StatusService, StatusLevel } from "@/lib/status-checks";
import { StatusBadge } from "./StatusBadge";
import { StatusCard } from "./StatusCard";
import { Button } from "@/components/ui/button";
import { RefreshCcw } from "lucide-react";

interface StatusPageClientProps {
  initialSnapshot: StatusSnapshot;
  refreshMinutes: number;
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

export function StatusPageClient({ initialSnapshot, refreshMinutes }: StatusPageClientProps) {
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

  const summary = useMemo(() => statusCopy[snapshot.overall] ?? statusCopy.unknown, [snapshot.overall]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-background/90 px-4 py-12 text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <section className="rounded-3xl border border-border/70 bg-card/70 p-6 shadow-md backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <StatusBadge status={snapshot.overall} />
              <h1 className="text-3xl font-semibold tracking-tight">{summary.headline}</h1>
              <p className="text-base text-muted-foreground">{summary.description}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm text-muted-foreground">
                <p>Last updated</p>
                <p className="font-medium text-foreground">
                  {new Date(snapshot.generatedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
                <p className="text-xs">Auto-refresh: every {refreshMinutes || 15} min</p>
              </div>
              <Button onClick={refresh} disabled={isPending} variant="outline" className="gap-2">
                <RefreshCcw className={isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                Refresh
              </Button>
            </div>
          </div>
          {error && (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {error}
            </p>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {snapshot.services.map((service: StatusService) => (
            <StatusCard key={service.id} service={service} />
          ))}
        </section>
      </div>
    </div>
  );
}

