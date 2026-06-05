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
          "bg-destructive text-destructive-foreground shadow-[var(--shadow-control)] hover:bg-destructive/90",
        danger:
          "bg-destructive text-destructive-foreground shadow-[var(--shadow-control)] hover:bg-destructive/90",
        success:
          "bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))] shadow-[var(--shadow-control)] hover:bg-[hsl(var(--success)/0.9)]",
        warning:
          "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))] shadow-[var(--shadow-control)] hover:bg-[hsl(var(--warning)/0.9)]",
        neutral:
          "border border-input bg-card/95 bg-[image:var(--gradient-surface)] text-foreground shadow-[var(--shadow-hairline)] backdrop-blur-md hover:border-primary/35 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
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
          "!rounded-[var(--radius-nav)] border border-transparent text-muted-foreground hover:border-primary/25 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary data-[active=true]:border-primary/30 data-[active=true]:bg-[hsl(var(--nav-active-bg))] data-[active=true]:bg-[image:var(--gradient-nav-active)] data-[active=true]:text-primary data-[active=true]:shadow-[var(--shadow-hairline)]",
        headerIcon:
          "border border-[hsl(var(--header-control-border))] bg-[hsl(var(--header-control-bg))] text-foreground shadow-[var(--shadow-hairline)] backdrop-blur-md hover:border-[hsl(var(--header-control-border-hover))] hover:bg-[hsl(var(--header-control-hover))] hover:text-foreground",
        statusAction:
          "border border-[hsl(var(--header-control-border))] bg-[hsl(var(--header-control-bg))] text-foreground shadow-[var(--shadow-hairline)] backdrop-blur-md hover:border-[hsl(var(--header-control-border-hover))] hover:bg-[hsl(var(--header-control-hover))] hover:text-primary",
        compactUtility:
          "border border-input bg-card/95 bg-[image:var(--gradient-surface)] text-foreground shadow-[var(--shadow-hairline)] backdrop-blur-md hover:border-primary/35 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
        game:
          "border border-white/20 bg-slate-950/80 text-white shadow-[var(--shadow-raised)] hover:bg-slate-900/90",
        outline:
          "border border-input bg-card/95 bg-[image:var(--gradient-surface)] text-foreground shadow-[var(--shadow-hairline)] backdrop-blur-md hover:border-primary/35 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
        secondary:
          "border border-border/70 bg-secondary/90 bg-[image:var(--gradient-panel)] text-secondary-foreground shadow-[var(--shadow-hairline)] hover:border-primary/25 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
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
