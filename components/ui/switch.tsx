"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/*
 * The app's one switch. Two byte-identical bespoke switches lived in
 * wallet-profile with magic pixel offsets and untokenized motion; this is the
 * single source, on the design system's motion tokens, with a 44px hit area.
 */
export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  "aria-label": string;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, className, ...props }, ref) => (
    <button
      type="button"
      ref={ref}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex min-h-11 min-w-14 items-center justify-center rounded-[var(--radius-control)] p-0",
        "transition-colors duration-[var(--motion-quick)] ease-[var(--ease-standard)] hover:bg-[hsl(var(--nav-hover-bg))]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      role="switch"
      aria-checked={checked}
      {...props}
    >
      <span
        className={cn(
          "relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)]",
          checked ? "bg-[hsl(var(--success))]" : "bg-muted",
        )}
        aria-hidden="true"
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-[var(--motion-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none",
            checked ? "translate-x-[22px]" : "translate-x-[4px]",
          )}
        />
      </span>
    </button>
  ),
);
Switch.displayName = "Switch";
