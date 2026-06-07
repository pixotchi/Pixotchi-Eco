import * as React from "react";
import { RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";

type RefreshIconProps = React.ComponentPropsWithoutRef<typeof RefreshCw> & {
  refreshing?: boolean;
};

export function RefreshIcon({ className, refreshing = false, ...props }: RefreshIconProps) {
  return (
    <RefreshCw
      aria-hidden="true"
      {...props}
      className={cn(
        "transition-transform duration-[var(--motion-standard)] ease-[var(--ease-standard)]",
        refreshing && "animate-spin",
        className
      )}
    />
  );
}
