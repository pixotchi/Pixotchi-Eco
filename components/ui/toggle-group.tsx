"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { useSelectionIndicator } from "@/components/hooks/use-selection-indicator";
import { getRovingIndex } from "@/lib/roving-index";
import { cn } from "@/lib/utils";

export type ToggleValue = string | number;

export interface ToggleOption {
  value: ToggleValue;
  label: React.ReactNode;
  ariaLabel?: string;
}

export interface ToggleGroupProps {
  value: ToggleValue;
  onValueChange: (value: ToggleValue) => void;
  options: ToggleOption[];
  size?: "sm" | "default" | "lg";
  className?: string;
  getButtonClassName?: (value: ToggleValue, selected: boolean) => string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  orientation?: "horizontal" | "vertical";
}

// NB: every entry must re-declare its own min-h. These strings are merged AFTER the
// Button's cva size (`compact`) by tailwind-merge, so an entry without min-h would
// inherit compact's 32px floor rather than the height it appears to set.
const sizeClassNames = {
  /* Original 40px density restored by request — the 44px floor bump made the
     app's segmented controls read as oversized. lg remains the 44px option. */
  sm: "h-auto min-h-10 px-2.5 py-1.5 text-xs",
  default: "h-auto min-h-10 px-3 py-1.5 text-xs sm:text-sm",
  lg: "h-auto min-h-11 px-3.5 py-2 text-sm",
} as const;

export function ToggleGroup({
  value,
  onValueChange,
  options,
  size = "sm",
  className,
  getButtonClassName,
  ariaLabel,
  ariaLabelledBy,
  orientation = "horizontal",
}: ToggleGroupProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const indicatorRef = React.useRef<HTMLSpanElement | null>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((opt) => opt.value === value);
  const suppressNextIndicatorMotionRef = useSelectionIndicator({
    containerRef, indicatorRef, itemRefs: optionRefs, selectedIndex,
    itemCount: options.length, layoutKey: orientation + size,
  });

  const focusOption = (index: number) => {
    optionRefs.current[index]?.focus();
  };

  const selectOption = (index: number, animateIndicator = true) => {
    const option = options[index];
    if (!option) return;
    suppressNextIndicatorMotionRef.current = !animateIndicator;
    onValueChange(option.value);
    focusOption(index);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = getRovingIndex(event.key, index, options.length, orientation);
    if (nextIndex === null) return;
    event.preventDefault();

    // Keyboard navigation should feel immediate; reserve the glide for pointer
    // selection where spatial continuity is useful.
    selectOption(nextIndex, false);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "surface-inset relative isolate inline-flex items-center rounded-[calc(var(--radius-nav)+0.125rem)] border border-solid border-[hsl(var(--edge-panel))] p-0.5",
        orientation === "vertical" && "flex-col",
        className
      )}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-orientation={orientation}
    >
      <span
        ref={indicatorRef}
        aria-hidden="true"
        className="surface-control-selected pointer-events-none absolute left-0 top-0 z-0 rounded-[var(--radius-nav)] border opacity-0"
      />
      {options.map((opt, index) => (
        <Button
          key={String(opt.value)}
          type="button"
          size="compact"
          variant="ghost"
          role="radio"
          aria-checked={value === opt.value}
          // No String(opt.value) fallback: for a ReactNode label that produced an
          // invented name like "plants" against visible text "Plants", which is a
          // WCAG 2.5.3 (Label in Name) failure. Undefined lets the accessible name
          // come from the rendered content, which is what the label already is.
          aria-label={opt.ariaLabel ?? (typeof opt.label === "string" ? opt.label : undefined)}
          tabIndex={index === Math.max(0, selectedIndex) ? 0 : -1}
          onClick={(event) => selectOption(index, event.detail !== 0)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          ref={(node) => {
            optionRefs.current[index] = node;
          }}
          className={cn(
            sizeClassNames[size],
            "relative z-10 flex min-w-11 items-center justify-center gap-1 !rounded-[var(--radius-nav)] bg-transparent shadow-none",
            value === opt.value
              // Same ink as the pill behind it (see --selected-control-foreground):
              // --primary as ink on a --primary-tinted surface measured 2.83:1 in dark.
              ? "text-[hsl(var(--selected-control-foreground))] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-transparent [@media(hover:hover)_and_(pointer:fine)]:hover:text-[hsl(var(--selected-control-foreground))]"
              // dark:text-foreground, not a blanket change: at /80 the unselected ink
              // measured 3.62:1 on the dark control surface. The seven light-family
              // themes are 7.7-8.5:1 at /80, so they keep the softer secondary weight.
              : "text-foreground/80 dark:text-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[hsl(var(--nav-hover-bg))] [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary",
            getButtonClassName?.(opt.value, value === opt.value)
          )}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
