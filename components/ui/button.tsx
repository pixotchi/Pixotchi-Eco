"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-semibold leading-none ring-offset-background transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-[var(--motion-quick)] ease-[var(--ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-px active:scale-[0.985] disabled:pointer-events-none disabled:translate-y-0 disabled:scale-100 disabled:opacity-55",
  {
    variants: {
      variant: {
        default: "bg-primary bg-[image:var(--gradient-control-active)] text-primary-foreground shadow-[var(--shadow-control)] hover:shadow-[var(--shadow-glow)] hover:brightness-[1.03]",
        primary: "bg-primary bg-[image:var(--gradient-control-active)] text-primary-foreground shadow-[var(--shadow-control)] hover:shadow-[var(--shadow-glow)] hover:brightness-[1.03]",
        destructive:
          "bg-destructive bg-[image:var(--gradient-danger)] text-destructive-foreground shadow-[var(--shadow-control)] hover:brightness-[1.03]",
        danger:
          "bg-destructive bg-[image:var(--gradient-danger)] text-destructive-foreground shadow-[var(--shadow-control)] hover:brightness-[1.03]",
        success:
          "bg-[hsl(var(--success))] bg-[image:var(--gradient-success)] text-[hsl(var(--success-foreground))] shadow-[var(--shadow-control)] hover:brightness-[1.03]",
        warning:
          "bg-[hsl(var(--warning))] bg-[image:var(--gradient-warning)] text-[hsl(var(--warning-foreground))] shadow-[var(--shadow-control)] hover:brightness-[1.03]",
        neutral:
          "border border-[hsl(var(--border-strong)/0.34)] bg-card bg-[image:var(--gradient-control-surface)] text-foreground shadow-[var(--shadow-hairline)] hover:border-primary/45 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
        special:
          "border border-primary/25 bg-primary bg-[image:var(--gradient-special)] text-primary-foreground shadow-[var(--shadow-control)] hover:shadow-[var(--shadow-glow)] hover:brightness-[1.04]",
        transaction:
          "bg-primary bg-[image:var(--gradient-control-active)] text-primary-foreground shadow-[var(--shadow-control)] hover:shadow-[var(--shadow-glow)] hover:brightness-[1.03]",
        transactionSuccess:
          "bg-[image:var(--gradient-success)] text-[hsl(var(--success-foreground))] shadow-[var(--shadow-control)] hover:brightness-105",
        gamePrimary:
          "border border-primary/25 bg-primary bg-[image:var(--gradient-control-active)] text-primary-foreground shadow-[var(--shadow-control)] hover:shadow-[var(--shadow-glow)] hover:brightness-[1.03]",
        reward:
          "border border-[hsl(var(--warning)/0.38)] bg-[hsl(var(--warning)/0.12)] bg-[image:var(--gradient-prize)] text-[hsl(var(--warning-foreground))] shadow-[var(--shadow-hairline)] hover:bg-[hsl(var(--warning)/0.18)]",
        promo:
          "border border-primary/25 bg-primary bg-[image:var(--gradient-special)] text-primary-foreground shadow-[var(--shadow-control)] hover:shadow-[var(--shadow-glow)] hover:brightness-[1.04]",
        nav:
          "!rounded-[var(--radius-nav)] border border-transparent text-muted-foreground hover:border-primary/35 hover:bg-[hsl(var(--nav-hover-bg))] hover:bg-[image:var(--gradient-nav-hover)] hover:text-primary hover:shadow-[var(--shadow-nav-hover)] data-[active=true]:border-[hsl(var(--border-strong)/0.48)] data-[active=true]:bg-[hsl(var(--nav-active-bg))] data-[active=true]:bg-[image:var(--gradient-nav-active)] data-[active=true]:text-primary data-[active=true]:shadow-[var(--shadow-nav-active)]",
        headerIcon:
          "border border-[hsl(var(--border-strong)/0.34)] bg-card bg-[image:var(--gradient-control-surface)] text-foreground shadow-[var(--shadow-control)] hover:border-primary/45 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
        statusAction:
          "border border-[hsl(var(--border-strong)/0.34)] bg-card bg-[image:var(--gradient-control-surface)] text-foreground shadow-[var(--shadow-control)] hover:border-primary/45 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
        surfaceControl:
          "border border-[hsl(var(--border-strong)/0.34)] bg-card bg-[image:var(--gradient-control-surface)] text-foreground shadow-[var(--shadow-control)] hover:border-primary/45 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
        imageCardPrimary:
          "border border-white/30 bg-slate-950 bg-[image:linear-gradient(180deg,hsl(222_47%_20%)_0%,hsl(222_47%_11%)_56%,hsl(229_84%_5%)_100%)] text-white shadow-[0_10px_24px_-14px_rgba(2,6,23,0.9)] hover:brightness-[1.06] hover:text-white hover:shadow-[0_14px_30px_-16px_rgba(2,6,23,0.95)]",
        compactUtility:
          "border border-[hsl(var(--border-strong)/0.34)] bg-card bg-[image:var(--gradient-control-surface)] text-foreground shadow-[var(--shadow-hairline)] hover:border-primary/45 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
        game:
          "border border-white/20 bg-slate-950/80 text-white shadow-[var(--shadow-raised)] hover:bg-slate-900/90",
        outline:
          "border border-[hsl(var(--border-strong)/0.34)] bg-card bg-[image:var(--gradient-control-surface)] text-foreground shadow-[var(--shadow-hairline)] hover:border-primary/45 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
        secondary:
          "border border-[hsl(var(--border-strong)/0.36)] bg-secondary/90 bg-[image:var(--gradient-panel)] text-secondary-foreground shadow-[var(--shadow-hairline)] hover:border-primary/35 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
        toggleActive:
          "border border-primary/20 bg-primary bg-[image:var(--gradient-control-active)] text-primary-foreground shadow-[var(--shadow-control)] hover:shadow-[var(--shadow-glow)] hover:brightness-[1.03]",
        ghost: "hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-10 min-h-10 px-2.5 py-1.5 text-xs",
        compact: "h-8 min-h-8 px-2.5 py-1 text-xs",
        status: "h-9 min-h-9 px-2.5 py-1.5 text-xs !gap-1.5",
        touchCompact: "h-11 min-h-11 px-3 py-2 text-xs",
        default: "h-11 min-h-11 px-4 py-2",
        md: "h-11 min-h-11 px-4 py-2",
        sm: "h-11 min-h-11 px-3 py-2 text-sm",
        lg: "h-12 min-h-12 px-6 text-base",
        icon: "h-11 min-h-11 w-11 min-w-11",
        iconCompact: "h-9 min-h-9 w-9 min-w-9",
        "icon-sm": "h-11 min-h-11 w-11 min-w-11",
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
    const Comp = asChild ? Slot : "button";

    if (asChild) {
      return (
        <Slot
          {...props}
          className={cn(buttonVariants({ variant, size, fullWidth }), className)}
          ref={ref}
          aria-busy={loading || props["aria-busy"] || undefined}
        >
          {children}
        </Slot>
      );
    }

    return (
      <Comp
        {...props}
        className={cn(buttonVariants({ variant, size, fullWidth }), className)}
        ref={ref}
        aria-busy={loading || props["aria-busy"] || undefined}
        disabled={disabled || loading}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : leadingIcon}
        {loading && loadingText ? loadingText : children}
        {!loading && trailingIcon}
      </Comp>
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
