"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Minus, Plus } from 'lucide-react';

interface QuantitySelectorProps {
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  max?: number;
  min?: number;
  size?: 'xs' | 'sm' | 'default';
}

export default function QuantitySelector({
  quantity,
  onQuantityChange,
  max = 80,
  min = 0,
  size = 'sm'
}: QuantitySelectorProps) {
  const handleIncrement = () => {
    if (quantity < max) {
      onQuantityChange(quantity + 1);
    }
  };

  const handleDecrement = () => {
    if (quantity > min) {
      onQuantityChange(quantity - 1);
    }
  };

  const compact = size === 'xs' || size === 'sm';
  // Original density restored (24px compact is the one bump kept — 20px sat
  // below WCAG 2.5.8's 24px minimum on a purchase control).
  const buttonSize = compact
    ? '!h-6 !min-h-6 !w-6 !min-w-6 p-0'
    : '!h-7 !min-h-7 !w-7 !min-w-7 p-0';
  const iconSize = compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5';
  const textSize = compact ? 'text-xs' : 'text-sm';

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        className={`${buttonSize}`}
        onClick={handleDecrement}
        disabled={quantity <= min}
        aria-label="Decrease quantity"
      >
        <Minus className={iconSize} />
      </Button>
      
      <span className={`${textSize} font-semibold min-w-[1rem] text-center tabular-nums`} aria-live="polite">
        {quantity}
      </span>
      
      <Button
        variant="outline"
        size="icon"
        className={`${buttonSize}`}
        onClick={handleIncrement}
        disabled={quantity >= max}
        aria-label="Increase quantity"
      >
        <Plus className={iconSize} />
      </Button>
    </div>
  );
}
