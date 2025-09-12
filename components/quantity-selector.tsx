"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Minus, Plus } from 'lucide-react';

interface QuantitySelectorProps {
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  max?: number;
  min?: number;
  size?: 'sm' | 'default';
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

  const buttonSize = size === 'sm' ? 'w-5 h-5' : 'w-7 h-7';
  const iconSize = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3.5 h-3.5';
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';

  return (
    <div className="flex items-center space-x-1">
      <Button
        variant="outline"
        size="icon"
        className={`${buttonSize} btn-compact ${quantity <= min ? 'opacity-50' : ''}`}
        onClick={handleDecrement}
        disabled={quantity <= min}
      >
        <Minus className={iconSize} />
      </Button>
      
      <span className={`${textSize} font-semibold min-w-[1rem] text-center`}>
        {quantity}
      </span>
      
      <Button
        variant="outline"
        size="icon"
        className={`${buttonSize} btn-compact ${quantity >= max ? 'opacity-50' : ''}`}
        onClick={handleIncrement}
        disabled={quantity >= max}
      >
        <Plus className={iconSize} />
      </Button>
    </div>
  );
} 