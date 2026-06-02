'use client';

import { StatusLevel } from '@/lib/status-checks';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: StatusLevel;
  className?: string;
}

const statusMap: Record<StatusLevel, { label: string; className: string }> = {
  operational: { label: 'Operational', className: 'bg-[hsl(var(--success)/0.14)] text-[hsl(var(--success-strong))]' },
  degraded: { label: 'Degraded', className: 'bg-[hsl(var(--warning)/0.16)] text-[hsl(var(--warning))]' },
  outage: { label: 'Outage', className: 'bg-destructive/10 text-destructive' },
  UntypedValue: { label: 'Unknown', className: 'bg-muted text-muted-foreground' },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusMap[status] ?? statusMap.UntypedValue;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-current/10 px-3 py-1 text-xs font-medium',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}
