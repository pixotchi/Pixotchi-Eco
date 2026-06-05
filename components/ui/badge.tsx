import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex min-h-7 items-center gap-1 rounded-[var(--radius-control)] border px-2 py-1 text-xs font-semibold leading-none",
  {
    variants: {
      variant: {
        default: "border-border/70 bg-background/70 text-foreground",
        neutral: "border-border/70 bg-muted/70 text-muted-foreground",
        success: "border-[hsl(var(--success)/0.25)] bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success-strong))]",
        warning: "border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.16)] text-[hsl(var(--warning-foreground))]",
        danger: "border-destructive/25 bg-destructive/10 text-destructive",
        info: "border-[hsl(var(--info)/0.25)] bg-[hsl(var(--info)/0.12)] text-[hsl(var(--info))]",
        chain: "border-primary/25 bg-primary/10 text-primary",
        special: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-200",
        game: "border-white/20 bg-slate-950/70 text-white",
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

export { Badge, badgeVariants };
