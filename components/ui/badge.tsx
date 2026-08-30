import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex min-h-7 items-center gap-1 rounded-[var(--radius-control)] border px-2 py-1 text-xs font-semibold leading-none",
  {
    variants: {
      variant: {
        default: "border-[hsl(var(--edge-panel))] bg-background/70 text-foreground",
        neutral: "border-[hsl(var(--edge-panel))] bg-muted/70 text-muted-foreground",
        success: "border-[hsl(var(--success)/0.25)] bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success-strong))]",
        /* --warning-strong, not --warning-foreground: the foreground token is
           tuned to sit on a FULL warning fill; on this 16% tint over --card it
           measured ~2.4:1 in dark. (--success one line up already follows the
           ink-token rule documented in globals.css.) */
        warning: "border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.16)] text-[hsl(var(--warning-strong))]",
        danger: "border-destructive/25 bg-destructive/10 text-destructive",
        info: "border-[hsl(var(--info)/0.25)] bg-[hsl(var(--info)/0.12)] text-[hsl(var(--info))]",
        chain: "border-primary/25 bg-primary/10 text-primary",
        special: "border-[hsl(var(--value)/0.28)] bg-[hsl(var(--value)/0.1)] text-value",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  ),
);
Badge.displayName = "Badge";

export { Badge };
