'use client';

import { StatusLevel } from '@/lib/status-checks';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: StatusLevel;
  className?: string;
}

const statusMap: Record<StatusLevel, { label: string; className: string }> = {
  operational: { label: 'Operational', className: 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-200' },
  degraded: { label: 'Degraded', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200' },
  outage: { label: 'Outage', className: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200' },
  unknown: { label: 'Unknown', className: 'bg-muted text-muted-foreground' },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusMap[status] ?? statusMap.unknown;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium tracking-wide',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}

