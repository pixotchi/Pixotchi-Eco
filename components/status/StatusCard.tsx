"use client";

import { StatusLevel,StatusService } from "@/lib/status-checks";
import { cn } from "@/lib/utils";
import { AlertTriangle,CheckCircle2,Info,WifiOff } from "lucide-react";
import { StatusBadge } from "./StatusBadge";

const statusToneMap: Record<StatusLevel, { icon: typeof CheckCircle2; iconClassName: string; tileClassName: string }> = {
  operational: {
    icon: CheckCircle2,
    iconClassName: "text-[hsl(var(--success-strong))]",
    tileClassName: "border-[hsl(var(--success)/0.26)] bg-[hsl(var(--success)/0.12)]",
  },
  degraded: {
    icon: AlertTriangle,
    iconClassName: "text-[hsl(var(--warning))]",
    tileClassName: "border-[hsl(var(--warning)/0.34)] bg-[hsl(var(--warning)/0.14)]",
  },
  outage: {
    icon: WifiOff,
    iconClassName: "text-destructive",
    tileClassName: "border-destructive/28 bg-destructive/10",
  },
  UntypedValue: {
    icon: Info,
    iconClassName: "text-muted-foreground",
    tileClassName: "border-border/60 bg-background/55",
  },
};

interface StatusCardProps {
  service: StatusService;
}

const formatLatency = (ms?: number) => {
  if (typeof ms !== "number" || Number.isNaN(ms)) return "—";
  if (ms > 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
};

export function StatusCard({ service }: StatusCardProps) {
  const rpcMetrics = service.id === "rpc"
    ? (service.metrics as { healthyCount?: number; totalCount?: number } | undefined)
    : undefined;
  const tone = statusToneMap[service.status] ?? statusToneMap.UntypedValue;
  const Icon = tone.icon;
  const metricRows = [
    { label: "Latency", value: formatLatency(service.latencyMs) },
    ...(rpcMetrics
      ? [{ label: "Healthy endpoints", value: `${rpcMetrics.healthyCount ?? 0}/${rpcMetrics.totalCount ?? 0}` }]
      : []),
  ];

  return (
    <article className="chromatic-white-surface rounded-[var(--radius-panel)] border border-[hsl(var(--edge-panel))] bg-card/90 bg-[image:var(--gradient-surface)] p-4 shadow-[var(--shadow-hairline)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border shadow-[var(--shadow-hairline)]",
              tone.tileClassName
            )}
          >
            <Icon className={cn("h-5 w-5", tone.iconClassName)} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold leading-tight text-foreground">{service.label}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {service.status === "operational"
                ? "Service is responding normally."
                : service.status === "degraded"
                  ? "Service is reachable with a degraded signal."
                  : service.status === "outage"
                    ? "Service is currently failing health checks."
                    : "Service signal is not fully configured."}
            </p>
          </div>
        </div>
        <StatusBadge status={service.status} />
      </div>

      <div className="mt-4 divide-y divide-[hsl(var(--divider)/0.5)] rounded-[var(--radius-control)] border border-border/60 bg-background/45 px-3 py-1 shadow-[var(--shadow-hairline)]">
        {metricRows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-4 py-2">
            <span className="shrink-0 text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
              {row.label}
            </span>
            <span className="min-w-0 text-right text-xs font-medium leading-snug text-foreground">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}
