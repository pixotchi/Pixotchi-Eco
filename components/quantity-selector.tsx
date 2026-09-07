"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Minus, Plus } from 'lucide-react';

interface QuantitySelectorProps {
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  max?: number;
  min?: number;
}

export default function QuantitySelector({
  quantity,
  onQuantityChange,
  max = 80,
  min = 0,
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

  const buttonClassName = 'h-8 min-h-8 w-8 min-w-8 rounded-[calc(var(--radius-control)-1px)] p-0';

  return (
    <div className="inline-flex shrink-0 items-center rounded-[var(--radius-control)] border border-input bg-card">
      <Button
        type="button"
        variant="ghost"
        size="compact"
        className={buttonClassName}
        onClick={handleDecrement}
        disabled={quantity <= min}
        aria-label="Decrease quantity"
      >
        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      
      <output className="min-w-8 px-1 text-center text-sm font-semibold tabular-nums" aria-label="Quantity" aria-live="polite">
        {quantity}
      </output>
      
      <Button
        type="button"
        variant="ghost"
        size="compact"
        className={buttonClassName}
        onClick={handleIncrement}
        disabled={quantity >= max}
        aria-label="Increase quantity"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
