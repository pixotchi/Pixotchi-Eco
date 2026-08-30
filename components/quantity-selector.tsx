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
  // 36px floor (compact) / 44px (default): the old 20px/28px steppers were
  // below even WCAG 2.5.8's 24px minimum, on a primary purchase control.
  const buttonSize = compact
    ? '!h-9 !min-h-9 !w-9 !min-w-9 p-0'
    : '!h-11 !min-h-11 !w-11 !min-w-11 p-0';
  const iconSize = compact ? 'h-3 w-3' : 'h-4 w-4';
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
