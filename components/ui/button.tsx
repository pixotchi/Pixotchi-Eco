"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-semibold leading-none ring-offset-background transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-[var(--motion-quick)] ease-[var(--ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-px active:scale-[0.985] disabled:pointer-events-none disabled:translate-y-0 disabled:scale-100 disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:translate-y-0 aria-disabled:scale-100 aria-disabled:opacity-55",
  {
    variants: {
      variant: {
        default:
          "bg-primary bg-[image:var(--gradient-control-active)] text-primary-foreground shadow-[var(--shadow-control)] hover:shadow-[var(--shadow-glow)] hover:brightness-[1.03]",
        destructive:
          "bg-destructive bg-[image:var(--gradient-danger)] text-destructive-foreground shadow-[var(--shadow-control)] hover:brightness-[1.03]",
        warning:
          "bg-[hsl(var(--warning))] bg-[image:var(--gradient-warning)] text-[hsl(var(--warning-foreground))] shadow-[var(--shadow-control)] hover:brightness-[1.03]",
        special:
          "border border-primary/25 bg-primary bg-[image:var(--gradient-special)] text-primary-foreground shadow-[var(--shadow-control)] hover:shadow-[var(--shadow-glow)] hover:brightness-[1.04]",
        /*
         * Like the chrome controls below, but with no active-state surface of its own:
         * SlidingNavTabs paints the selected pill as a separate animated indicator
         * element behind the buttons, so an active background here would double up.
         */
        navSliding:
          "!rounded-[var(--radius-nav)] border border-transparent bg-transparent shadow-none text-muted-foreground hover:border-primary/35 hover:bg-[hsl(var(--nav-hover-bg))] hover:bg-[image:var(--gradient-nav-hover)] hover:text-primary hover:shadow-[var(--shadow-nav-hover)] data-[active=true]:text-[hsl(var(--selected-control-foreground))] data-[active=true]:hover:bg-transparent data-[active=true]:hover:bg-none data-[active=true]:hover:shadow-none",
        headerIcon:
          "border border-[hsl(var(--border-strong)/0.34)] bg-card bg-[image:var(--gradient-control-surface)] text-foreground shadow-[var(--shadow-control)] hover:border-primary/45 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
        statusAction:
          "border border-[hsl(var(--border-strong)/0.34)] bg-card bg-[image:var(--gradient-control-surface)] text-foreground shadow-[var(--shadow-control)] hover:border-primary/45 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
        surfaceControl:
          "border border-[hsl(var(--border-strong)/0.34)] bg-card bg-[image:var(--gradient-control-surface)] text-foreground shadow-[var(--shadow-control)] hover:border-primary/45 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
        imageCardPrimary:
          "border border-white/30 bg-slate-950 bg-[image:linear-gradient(180deg,hsl(222_47%_20%)_0%,hsl(222_47%_11%)_56%,hsl(229_84%_5%)_100%)] text-white shadow-[0_10px_24px_-14px_rgba(2,6,23,0.9)] hover:brightness-[1.06] hover:text-white hover:shadow-[0_14px_30px_-16px_rgba(2,6,23,0.95)]",
        outline:
          "border border-[hsl(var(--border-strong)/0.34)] bg-card bg-[image:var(--gradient-control-surface)] text-foreground shadow-[var(--shadow-hairline)] hover:border-primary/45 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
        secondary:
          "border border-[hsl(var(--border-strong)/0.36)] bg-secondary/90 bg-[image:var(--gradient-panel)] text-secondary-foreground shadow-[var(--shadow-hairline)] hover:border-primary/35 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
        ghost: "hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
        link: "text-primary underline-offset-4 hover:underline",
      },
      /*
       * Heights are deliberate, not a ladder: sm / default / touchCompact / icon all
       * sit at h-11 (44px), the touch-target floor. compact (32px), status (36px) and
       * iconCompact (36px) are the explicit exceptions for dense chrome.
       * Removed: `xs` (h-10 — taller than `compact`, so the name lied), `md` and
       * `icon-sm` (byte-identical to `default` and `icon`).
       */
      size: {
        compact: "h-8 min-h-8 px-2.5 py-1 text-xs",
        status: "h-9 min-h-9 px-2.5 py-1.5 text-xs !gap-1.5",
        iconCompact: "h-9 min-h-9 w-9 min-w-9",
        touchCompact: "h-11 min-h-11 px-3 py-2 text-xs",
        sm: "h-11 min-h-11 px-3 py-2 text-sm",
        default: "h-11 min-h-11 px-4 py-2",
        icon: "h-11 min-h-11 w-11 min-w-11",
        lg: "h-12 min-h-12 px-6 text-base",
      },
      fullWidth: {
        true: "w-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  leadingIcon?: React.ReactNode;
  loading?: boolean;
  loadingText?: string;
  trailingIcon?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({
    children,
    className,
    disabled,
    leadingIcon,
    loading = false,
    loadingText,
    trailingIcon,
    variant,
    size,
    fullWidth,
    asChild = false,
    ...props
  }, ref) => {
    if (asChild) {
      // asChild renders a <span>/<a>/<Link>, where the `disabled` attribute is invalid.
      // Forward the state as aria-disabled instead — the cva base string carries matching
      // aria-disabled:* styles. This is hardening, not true disabling: a keyboard user can
      // still activate an <a>, so do not rely on it to gate a destructive action.
      return (
        <Slot
          {...props}
          className={cn(buttonVariants({ variant, size, fullWidth }), className)}
          ref={ref}
          aria-busy={loading || props["aria-busy"] || undefined}
          aria-disabled={disabled || loading || undefined}
        >
          {children}
        </Slot>
      );
    }

    return (
      <button
        {...props}
        className={cn(buttonVariants({ variant, size, fullWidth }), className)}
        ref={ref}
        aria-busy={loading || props["aria-busy"] || undefined}
        disabled={disabled || loading}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : leadingIcon}
        {loading && loadingText ? loadingText : children}
        {!loading && trailingIcon}
      </button>
    );
  }
);
Button.displayName = "Button";

const IconButton = React.forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "size" | "children"> & { icon: React.ReactNode }
>(({ icon, variant = "outline", ...props }, ref) => (
  <Button ref={ref} variant={variant} size="icon" {...props}>
    {icon}
  </Button>
));
IconButton.displayName = "IconButton";

export { Button, IconButton, buttonVariants }; 
