'use client';

import { StatusLevel } from '@/lib/status-checks';
import { cn } from '@/lib/utils';
import { StatusChip } from '@/components/ui/premium';

interface StatusBadgeProps {
  status: StatusLevel;
  className?: string;
}

const statusMap: Record<StatusLevel, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  operational: { label: 'Operational', tone: 'success' },
  degraded: { label: 'Degraded', tone: 'warning' },
  outage: { label: 'Outage', tone: 'danger' },
  UntypedValue: { label: 'Unknown', tone: 'neutral' },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusMap[status] ?? statusMap.UntypedValue;
  return (
    <StatusChip tone={config.tone} className={cn("shrink-0", className)}>
      {config.label}
    </StatusChip>
  );
}
