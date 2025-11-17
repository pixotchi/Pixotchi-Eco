"use client";

import { StatusService, StatusLevel } from "@/lib/status-checks";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Clock, Info, WifiOff } from "lucide-react";
import { StatusBadge } from "./StatusBadge";

const iconMap: Record<StatusLevel, React.ReactNode> = {
  operational: <CheckCircle2 className="h-5 w-5 text-green-500" aria-hidden />,
  degraded: <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />,
  outage: <WifiOff className="h-5 w-5 text-red-500" aria-hidden />,
  unknown: <Info className="h-5 w-5 text-muted-foreground" aria-hidden />,
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

  return (
    <div className="rounded-2xl border border-border/70 bg-card/70 p-4 shadow-sm transition hover:shadow-lg">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {iconMap[service.status]}
          <div>
            <h3 className="text-base font-semibold text-foreground">{service.label}</h3>
            <p className="text-xs text-muted-foreground">Latency: {formatLatency(service.latencyMs)}</p>
            {rpcMetrics && (
              <p className="text-xs text-muted-foreground">
                Healthy endpoints: {rpcMetrics.healthyCount ?? 0}/{rpcMetrics.totalCount ?? 0}
              </p>
            )}
          </div>
        </div>
        <StatusBadge status={service.status} />
      </div>
    </div>
  );
}

