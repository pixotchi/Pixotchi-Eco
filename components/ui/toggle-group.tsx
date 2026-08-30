"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { usePerformanceMode } from "@/components/ui/performance-mode";
import { cn } from "@/lib/utils";

export type ToggleValue = string | number;

type IndicatorGeometry = {
  height: number;
  left: number;
  top: number;
  width: number;
};

function parseMotionDuration(value: string, fallback: number) {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return fallback;
  if (value.trim().endsWith("ms")) return amount;
  if (value.trim().endsWith("s")) return amount * 1000;
  return fallback;
}

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
  const { enabled: performanceModeEnabled } = usePerformanceMode();
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const indicatorRef = React.useRef<HTMLSpanElement | null>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const targetIndicatorGeometryRef = React.useRef<IndicatorGeometry | null>(null);
  const indicatorAnimationRef = React.useRef<Animation | null>(null);
  const suppressNextIndicatorMotionRef = React.useRef(false);
  const selectedIndex = Math.max(0, options.findIndex((opt) => opt.value === value));
  const skipIndicatorMotion = performanceModeEnabled || prefersReducedMotion;

  React.useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setPrefersReducedMotion(reducedMotion.matches);
    syncPreference();

    try {
      reducedMotion.addEventListener("change", syncPreference);
      return () => reducedMotion.removeEventListener("change", syncPreference);
    } catch {
      reducedMotion.addListener(syncPreference);
      return () => reducedMotion.removeListener(syncPreference);
    }
  }, []);

  React.useEffect(() => () => {
    indicatorAnimationRef.current?.cancel();
    indicatorAnimationRef.current = null;
  }, []);

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    const selectedOption = optionRefs.current[selectedIndex];
    if (!container || !indicator || !selectedOption) {
      indicatorAnimationRef.current?.cancel();
      indicatorAnimationRef.current = null;
      targetIndicatorGeometryRef.current = null;
      if (indicator) indicator.style.opacity = "0";
      return;
    }

    const updateIndicator = (allowMotion = true) => {
      const nextGeometry: IndicatorGeometry = {
        height: selectedOption.offsetHeight,
        left: selectedOption.offsetLeft,
        top: selectedOption.offsetTop,
        width: selectedOption.offsetWidth,
      };
      const previousTarget = targetIndicatorGeometryRef.current;

      if (
        previousTarget &&
        previousTarget.height === nextGeometry.height &&
        previousTarget.left === nextGeometry.left &&
        previousTarget.top === nextGeometry.top &&
        previousTarget.width === nextGeometry.width
      ) {
        suppressNextIndicatorMotionRef.current = false;
        if (skipIndicatorMotion && indicatorAnimationRef.current) {
          indicatorAnimationRef.current.cancel();
          indicatorAnimationRef.current = null;
        }
        return;
      }

      // Measure before cancelling an in-flight animation. The resulting inverse
      // transform starts at the currently rendered pill, so a rapid retarget
      // continues smoothly instead of snapping to its previous destination.
      const indicatorRect = indicator.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const previousVisualGeometry = previousTarget && indicatorRect.width > 0 && indicatorRect.height > 0
        ? {
            height: indicatorRect.height,
            left: indicatorRect.left - containerRect.left - container.clientLeft,
            top: indicatorRect.top - containerRect.top - container.clientTop,
            width: indicatorRect.width,
          }
        : null;
      indicatorAnimationRef.current?.cancel();
      indicatorAnimationRef.current = null;

      const finalTransform = `translate3d(${nextGeometry.left}px, ${nextGeometry.top}px, 0) scale(1, 1)`;
      indicator.style.height = `${nextGeometry.height}px`;
      indicator.style.opacity = "1";
      indicator.style.transform = finalTransform;
      indicator.style.transformOrigin = "top left";
      indicator.style.width = `${nextGeometry.width}px`;

      const shouldAnimate =
        allowMotion &&
        previousVisualGeometry !== null &&
        !suppressNextIndicatorMotionRef.current &&
        !skipIndicatorMotion &&
        typeof indicator.animate === "function";
      suppressNextIndicatorMotionRef.current = false;
      targetIndicatorGeometryRef.current = nextGeometry;
      if (!shouldAnimate) return;

      const computedStyle = window.getComputedStyle(container);
      const duration = parseMotionDuration(
        computedStyle.getPropertyValue("--motion-standard"),
        220
      );
      const easing = computedStyle.getPropertyValue("--ease-standard").trim() || "cubic-bezier(0.2, 0.8, 0.2, 1)";
      const animation = indicator.animate(
        [
          {
            transform: `translate3d(${previousVisualGeometry.left}px, ${previousVisualGeometry.top}px, 0) scale(${previousVisualGeometry.width / nextGeometry.width}, ${previousVisualGeometry.height / nextGeometry.height})`,
          },
          { transform: finalTransform },
        ],
        { duration, easing }
      );
      indicatorAnimationRef.current = animation;
      animation.onfinish = () => {
        if (indicatorAnimationRef.current === animation) {
          indicatorAnimationRef.current = null;
        }
      };
    };

    updateIndicator();

    if (typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(() => updateIndicator(false));
    resizeObserver.observe(container);
    optionRefs.current.forEach((option) => {
      if (option) resizeObserver.observe(option);
    });

    return () => {
      resizeObserver.disconnect();
    };
  }, [options.length, orientation, selectedIndex, size, skipIndicatorMotion]);

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
    if (options.length === 0) return;

    const isHorizontal = orientation === "horizontal";
    const previousKey = isHorizontal ? "ArrowLeft" : "ArrowUp";
    const nextKey = isHorizontal ? "ArrowRight" : "ArrowDown";

    let nextIndex = index;

    if (event.key === previousKey) {
      event.preventDefault();
      nextIndex = (index - 1 + options.length) % options.length;
    } else if (event.key === nextKey) {
      event.preventDefault();
      nextIndex = (index + 1) % options.length;
    } else if (event.key === "Home") {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === "End") {
      event.preventDefault();
      nextIndex = options.length - 1;
    } else {
      return;
    }

    // Keyboard navigation should feel immediate; reserve the glide for pointer
    // selection where spatial continuity is useful.
    selectOption(nextIndex, false);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "surface-control relative isolate inline-flex items-center rounded-[calc(var(--radius-nav)+0.125rem)] border p-0.5",
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
          tabIndex={index === selectedIndex ? 0 : -1}
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
