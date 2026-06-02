import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-semibold leading-none ring-offset-background transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-[var(--motion-quick)] ease-[var(--ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-px disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-55",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[var(--shadow-control)] hover:bg-primary/90",
        primary: "bg-primary text-primary-foreground shadow-[var(--shadow-control)] hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[var(--shadow-control)] hover:bg-destructive/90",
        danger:
          "bg-destructive text-destructive-foreground shadow-[var(--shadow-control)] hover:bg-destructive/90",
        success:
          "bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))] shadow-[var(--shadow-control)] hover:bg-[hsl(var(--success)/0.9)]",
        warning:
          "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))] shadow-[var(--shadow-control)] hover:bg-[hsl(var(--warning)/0.9)]",
        neutral:
          "border border-border/70 bg-background/70 text-foreground shadow-[var(--shadow-hairline)] hover:bg-accent/70",
        special:
          "bg-[image:var(--gradient-special)] text-white shadow-[var(--shadow-control)] hover:brightness-105",
        gasless:
          "border border-[hsl(var(--success)/0.28)] bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success-strong))] hover:bg-[hsl(var(--success)/0.18)]",
        game:
          "border border-white/20 bg-slate-950/80 text-white shadow-[var(--shadow-raised)] hover:bg-slate-900/90",
        outline:
          "border border-input bg-background/80 shadow-[var(--shadow-hairline)] hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-[var(--shadow-hairline)] hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-7 min-h-7 px-2 text-xs",
        default: "h-11 min-h-11 px-4 py-2",
        md: "h-11 min-h-11 px-4 py-2",
        sm: "h-9 min-h-9 px-3 text-sm",
        lg: "h-12 min-h-12 px-6 text-base",
        icon: "h-11 min-h-11 w-11 min-w-11",
        "icon-sm": "h-9 min-h-9 w-9 min-w-9",
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
