import * as React from "react";
import { CheckCircle2, Info, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

export function SectionTitle({
  children,
  className,
  eyebrow,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { eyebrow?: React.ReactNode }) {
  return (
    <div className={cn("min-w-0 space-y-1", className)} {...props}>
      {eyebrow ? (
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {eyebrow}
        </div>
      ) : null}
      <h3 className="text-base font-semibold leading-tight text-foreground">{children}</h3>
    </div>
  );
}

export function MetricCard({
  icon,
  label,
  value,
  className,
  supportingText,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
  supportingText?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-[var(--radius-panel)] border border-border/60 bg-card/90 p-3 shadow-[var(--shadow-hairline)]", className)}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums text-foreground">{value}</div>
      {supportingText ? <div className="mt-1 text-xs text-muted-foreground">{supportingText}</div> : null}
    </div>
  );
}

export function StatusChip({
  children,
  className,
  tone = "neutral",
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "success" | "warning" | "info" | "danger";
}) {
  const toneClassName = {
    danger: "border-destructive/25 bg-destructive/10 text-destructive",
    info: "border-[hsl(var(--info)/0.25)] bg-[hsl(var(--info)/0.12)] text-[hsl(var(--info))]",
    neutral: "border-border/70 bg-background/70 text-muted-foreground",
    success: "border-[hsl(var(--success)/0.25)] bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success-strong))]",
    warning: "border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.16)] text-[hsl(var(--warning-foreground))]",
  }[tone];

  return (
    <span className={cn("inline-flex min-h-6 items-center rounded-[var(--radius-control)] border px-2 py-0.5 text-xs font-semibold leading-none", toneClassName, className)}>
      {children}
    </span>
  );
}

export function ActionBar({
  children,
  className,
  sticky = true,
}: React.HTMLAttributes<HTMLDivElement> & { sticky?: boolean }) {
  return (
    <div
      className={cn(
        sticky
          ? "surface-footer-divider dialog-footer-surface sticky -bottom-5 z-10 -mx-5 -mb-5 mt-3 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom),var(--browser-safe-area-bottom))] pt-3 sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:mt-4 sm:px-6"
          : "bg-inherit",
        className
      )}
    >
      {children}
    </div>
  );
}

export function DisabledReason({
  children,
  className,
  icon,
}: React.HTMLAttributes<HTMLDivElement> & { icon?: React.ReactNode }) {
  if (!children) return null;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-[var(--radius-panel)] border border-border/70 bg-background/55 px-3 py-2 text-xs leading-relaxed text-muted-foreground",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <span className="mt-0.5 text-primary">{icon ?? <Info className="h-3.5 w-3.5" aria-hidden="true" />}</span>
      <span>{children}</span>
    </div>
  );
}

export function RewardResultPanel({
  children,
  className,
  title = "Result",
  tone = "success",
}: React.HTMLAttributes<HTMLDivElement> & {
  title?: React.ReactNode;
  tone?: "success" | "warning" | "info";
}) {
  const toneClassName = {
    info: "border-[hsl(var(--info)/0.24)] bg-[hsl(var(--info)/0.08)]",
    success: "border-[hsl(var(--success)/0.26)] bg-[hsl(var(--success)/0.09)]",
    warning: "border-[hsl(var(--warning)/0.34)] bg-[hsl(var(--warning)/0.12)]",
  }[tone];
  const Icon = tone === "success" ? CheckCircle2 : Sparkles;

  return (
    <div className={cn("rounded-[var(--radius-panel)] border p-3 text-sm shadow-[var(--shadow-hairline)]", toneClassName, className)} role="status" aria-live="polite">
      <div className="flex items-center gap-2 font-semibold text-foreground">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        <span>{title}</span>
      </div>
      <div className="mt-2 text-muted-foreground">{children}</div>
    </div>
  );
}
