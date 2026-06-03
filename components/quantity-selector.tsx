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

  const buttonSize = size === 'xs'
    ? '!h-8 !min-h-8 !w-8 !min-w-8 p-0'
    : '!h-11 !min-h-11 !w-11 !min-w-11 p-0';
  const iconSize = size === 'xs' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const textSize = size === 'xs' ? 'text-[11px]' : size === 'sm' ? 'text-xs' : 'text-sm';
  const gapSize = size === 'xs' ? 'gap-1' : 'gap-1.5';

  return (
    <div className={`flex items-center ${gapSize}`}>
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
