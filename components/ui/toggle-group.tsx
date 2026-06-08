"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
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

const sizeClassNames = {
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
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, options.findIndex((opt) => opt.value === value));
  const [indicatorStyle, setIndicatorStyle] = React.useState<React.CSSProperties>({
    opacity: 0,
  });

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const selectedOption = optionRefs.current[selectedIndex];
    if (!container || !selectedOption) return;

    const updateIndicator = () => {
      setIndicatorStyle({
        height: selectedOption.offsetHeight,
        opacity: 1,
        transform: `translate3d(${selectedOption.offsetLeft}px, ${selectedOption.offsetTop}px, 0)`,
        width: selectedOption.offsetWidth,
      });
    };

    updateIndicator();

    if (typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(updateIndicator);
    resizeObserver.observe(container);
    optionRefs.current.forEach((option) => {
      if (option) resizeObserver.observe(option);
    });

    return () => resizeObserver.disconnect();
  }, [options.length, orientation, selectedIndex, size]);

  const focusOption = (index: number) => {
    optionRefs.current[index]?.focus();
  };

  const selectOption = (index: number) => {
    const option = options[index];
    if (!option) return;
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

    selectOption(nextIndex);
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
        aria-hidden="true"
        className="surface-control-selected pointer-events-none absolute left-0 top-0 z-0 rounded-[var(--radius-nav)] border transition-[transform,width,height,opacity] duration-[var(--motion-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none"
        style={indicatorStyle}
      />
      {options.map((opt, index) => (
        <Button
          key={String(opt.value)}
          type="button"
          size="xs"
          variant="ghost"
          role="radio"
          aria-checked={value === opt.value}
          aria-label={opt.ariaLabel ?? (typeof opt.label === "string" ? opt.label : String(opt.value))}
          tabIndex={value === opt.value ? 0 : index === selectedIndex ? 0 : -1}
          onClick={() => selectOption(index)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          ref={(node) => {
            optionRefs.current[index] = node;
          }}
          className={cn(
            sizeClassNames[size],
            "relative z-10 flex min-w-11 items-center justify-center gap-1 !rounded-[var(--radius-nav)] bg-transparent shadow-none",
            value === opt.value
              ? "text-primary hover:bg-transparent hover:text-primary"
              : "text-foreground/80 hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary",
            getButtonClassName?.(opt.value, value === opt.value)
          )}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
