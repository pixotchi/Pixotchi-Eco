"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type ProgressBarProps = React.HTMLAttributes<HTMLDivElement> & {
  label: string;
  value: number;
};

export function ProgressBar({ className, label, value, ...props }: ProgressBarProps) {
  const normalizedValue = Math.max(0, Math.min(100, value));

  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(normalizedValue)}
      className={cn(
        "h-2.5 overflow-hidden rounded-full border border-border/45 bg-secondary/80 shadow-inner",
        className
      )}
      role="progressbar"
      {...props}
    >
      <div
        className="h-full rounded-full bg-[hsl(var(--success))] bg-[image:var(--gradient-success)] shadow-[0_0_10px_hsl(var(--success)/0.28)] transition-[width] duration-[var(--motion-standard)] ease-[var(--ease-standard)]"
        style={{ width: `${normalizedValue}%` }}
      />
    </div>
  );
}
