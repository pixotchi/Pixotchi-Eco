import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative w-full overflow-hidden rounded-[var(--radius-panel)] border bg-card/95 bg-[image:var(--gradient-surface)] p-3.5 text-foreground shadow-[var(--shadow-hairline)] backdrop-blur-[var(--blur-surface)] [&>svg~*]:pl-7 [&>svg]:absolute [&>svg]:left-3.5 [&>svg]:top-3.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "border-border/70",
        info:
          "border-[hsl(var(--info)/0.28)] bg-[hsl(var(--info)/0.1)] [&>svg]:text-[hsl(var(--info))]",
        success:
          "border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.1)] [&>svg]:text-[hsl(var(--success-strong))]",
        warning:
          "border-[hsl(var(--warning)/0.36)] bg-[hsl(var(--warning)/0.14)] [&>svg]:text-[hsl(var(--warning))]",
        destructive:
          "border-destructive/35 bg-destructive/10 [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-1 text-sm font-semibold leading-tight text-foreground", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm leading-relaxed text-muted-foreground [&_p]:leading-relaxed", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
