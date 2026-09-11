import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("glass-skeleton rounded-[var(--radius-control)] bg-muted/50", className)}
      {...props}
    />
  )
}

export { Skeleton }
