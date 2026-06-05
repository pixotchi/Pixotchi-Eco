import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const panelVariants = cva(
  "rounded-[var(--radius-panel)] border text-card-foreground",
  {
    variants: {
      variant: {
        default: "border-border/60 bg-card/95 bg-[image:var(--gradient-surface)] surface-shadow backdrop-blur-md",
        soft: "border-border/55 bg-secondary/80 bg-[image:var(--gradient-panel)] surface-inset",
        elevated: "border-border/65 bg-card bg-[image:var(--gradient-surface-strong)] surface-shadow-raised backdrop-blur-md",
        inset: "border-border/55 bg-secondary/80 bg-[image:var(--gradient-panel)] surface-inset",
        game: "border-white/15 bg-slate-950/75 text-white shadow-[var(--shadow-raised)]",
      },
      padding: {
        none: "p-0",
        sm: "p-3",
        md: "p-4",
        lg: "p-5",
      },
    },
    defaultVariants: {
      variant: "default",
      padding: "md",
    },
  },
);

export interface PanelProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof panelVariants> {}

const Panel = React.forwardRef<HTMLDivElement, PanelProps>(
  ({ className, padding, variant, ...props }, ref) => (
    <div ref={ref} className={cn(panelVariants({ padding, variant }), className)} {...props} />
  ),
);
Panel.displayName = "Panel";

export { Panel, panelVariants };
