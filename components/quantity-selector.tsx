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
  const buttonSize = compact
    ? '!h-5 !min-h-5 !w-5 !min-w-5 p-0'
    : '!h-7 !min-h-7 !w-7 !min-w-7 p-0';
  const iconSize = compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5';
  const textSize = compact ? 'text-xs' : 'text-sm';

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        className={`${buttonSize} ${quantity <= min ? 'opacity-50' : ''}`}
        onClick={handleDecrement}
        disabled={quantity <= min}
        aria-label="Decrease quantity"
      >
        <Minus className={iconSize} />
      </Button>
      
      <span className={`${textSize} font-semibold min-w-[1rem] text-center`}>
        {quantity}
      </span>
      
      <Button
        variant="outline"
        size="icon-sm"
        className={`${buttonSize} ${quantity >= max ? 'opacity-50' : ''}`}
        onClick={handleIncrement}
        disabled={quantity >= max}
        aria-label="Increase quantity"
      >
        <Plus className={iconSize} />
      </Button>
    </div>
  );
}
