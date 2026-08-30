import * as React from "react";
import { CheckCircle2, Info, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/*
 * StatusChip is a thin alias over Badge: the two used to be near-duplicate
 * implementations rendering at 24px vs 28px with drifted tone maps, so chips
 * and badges never lined up on the same row. Badge is the single source now;
 * this keeps the `tone` API for the existing call sites.
 */
const STATUS_CHIP_TONE_TO_VARIANT = {
  danger: "danger",
  info: "info",
  neutral: "neutral",
  success: "success",
  warning: "warning",
} as const;

export function StatusChip({
  children,
  className,
  tone = "neutral",
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: keyof typeof STATUS_CHIP_TONE_TO_VARIANT;
}) {
  return (
    <Badge
      variant={STATUS_CHIP_TONE_TO_VARIANT[tone]}
      /* Preserve StatusChip's original 24px density (Badge's default is 28px)
         while keeping Badge as the single visual source. */
      className={cn("min-h-6 px-2 py-0.5", className)}
    >
      {children}
    </Badge>
  );
}

export function InlineBalanceNotice({
  children,
  className,
}: React.HTMLAttributes<HTMLDivElement>) {
  if (!children) return null;
  return (
    <div
      className={cn(
        "mt-2 flex min-h-10 w-full items-center justify-start gap-2 rounded-full border border-destructive/35 bg-destructive/10 bg-[linear-gradient(180deg,hsl(var(--destructive)/0.10)_0%,hsl(var(--destructive)/0.06)_100%)] px-3.5 py-2 text-left text-xs font-medium leading-snug text-foreground/70 shadow-[var(--shadow-hairline)]",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <Info className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
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
