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
}

export function ToggleGroup({ value, onValueChange, options, size = "sm", className, getButtonClassName }: ToggleGroupProps) {
  return (
    <div className={cn("inline-flex items-center p-0.5 rounded-md border border-border bg-card shadow-sm", className)}>
      {options.map((opt) => (
        <Button
          key={String(opt.value)}
          size="sm"
          variant={value === opt.value ? "secondary" : "ghost"}
          onClick={() => onValueChange(opt.value)}
          className={cn("flex items-center gap-1 h-7 px-2 text-xs", getButtonClassName?.(opt.value, value === opt.value))}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}


