import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
type ArcadeTone = "default" | "primary" | "success" | "warning" | "danger";

function getArcadeToneClassName(tone: ArcadeTone) {
  return {
    danger: "text-destructive",
    default: "text-foreground",
    primary: "text-primary",
    success: "text-[hsl(var(--success-strong))]",
    warning: "text-[hsl(var(--warning-strong))]",
  }[tone];
}

export function ArcadeStatLine({
  label,
  value,
  tone = "default",
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: ArcadeTone;
}) {
  return (
    <dl className="grid min-h-9 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start gap-3 py-2 [overflow-wrap:anywhere]">
      <dt className="min-w-0 text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 text-right font-semibold tabular-nums", getArcadeToneClassName(tone))}>
        {value}
      </dd>
    </dl>
  );
}
