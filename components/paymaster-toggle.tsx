"use client";

import { Zap } from "lucide-react";

import { cn } from "@/lib/utils";

interface SponsoredBadgeProps {
  show: boolean;
  className?: string;
}

/**
 * "Gas sponsored" indicator.
 *
 * This used to be a stub that rendered null while all 15 call sites (mint,
 * arcade, leaderboard, item details, upgrades, plant naming) kept computing and
 * passing `show` — gas sponsorship, a headline smart-wallet benefit, had no UI
 * signal anywhere in the app.
 */
export function SponsoredBadge({ show, className = "" }: SponsoredBadgeProps) {
  if (!show) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.12)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--success-strong))]",
        className,
      )}
    >
      <Zap className="h-3 w-3" aria-hidden="true" />
      Sponsored
    </span>
  );
}
