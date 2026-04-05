"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ToggleValue = string | number;

export interface ToggleOption {
  value: ToggleValue;
  label: React.ReactNode;
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
  sm: "h-7 px-2 text-xs",
  default: "h-8 px-3 text-xs sm:text-sm",
  lg: "h-9 px-4 text-sm",
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
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, options.findIndex((opt) => opt.value === value));

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
      className={cn("inline-flex items-center p-0.5 rounded-md border border-border bg-card shadow-sm", className)}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-orientation={orientation}
    >
      {options.map((opt, index) => (
        <Button
          key={String(opt.value)}
          type="button"
          size="xs"
          variant={value === opt.value ? "secondary" : "ghost"}
          role="radio"
          aria-checked={value === opt.value}
          aria-label={typeof opt.label === "string" ? opt.label : String(opt.value)}
          tabIndex={value === opt.value ? 0 : index === selectedIndex ? 0 : -1}
          onClick={() => selectOption(index)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          ref={(node) => {
            optionRefs.current[index] = node;
          }}
          className={cn(
            sizeClassNames[size],
            "flex items-center gap-1 rounded-md",
            getButtonClassName?.(opt.value, value === opt.value)
          )}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
