"use client";

import { useEffect, useState } from "react";
import { RefreshIcon } from "@/components/ui/refresh-icon";
import { cn } from "@/lib/utils";

/** Keep a fixed slot and only announce reads that outlast a quick interaction. */
export function BackgroundRefresh({ active, label, className }: {
  active: boolean;
  label: string;
  className?: string;
}) {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!active) {
      setDelayed(false);
      return;
    }
    const timer = setTimeout(() => setDelayed(true), 500);
    return () => clearTimeout(timer);
  }, [active]);
  const visible = active && delayed;

  return (
    <span role="status" className={cn("inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground", className)} title={visible ? label : undefined}>
      {visible && <><RefreshIcon refreshing className="h-3.5 w-3.5 motion-reduce:animate-none" /><span className="sr-only">{label}</span></>}
    </span>
  );
}
