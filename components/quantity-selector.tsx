"use client";

import React, { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Minus, Plus } from 'lucide-react';

interface QuantitySelectorProps {
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  onValidityChange?: (valid: boolean) => void;
  max?: number;
  min?: number;
}

export default function QuantitySelector({
  quantity,
  onQuantityChange,
  onValidityChange,
  max = 80,
  min = 0,
}: QuantitySelectorProps) {
  const inputId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const commitDraft = () => {
    if (draft === null) return;
    if (!/^\d+$/.test(draft) || !Number.isSafeInteger(Number(draft))) {
      setMessage(`Enter a whole number from ${min} to ${max}.`);
      onValidityChange?.(false);
      return;
    }
    const next = Math.min(max, Math.max(min, Number(draft)));
    onQuantityChange(next);
    onValidityChange?.(true);
    setMessage(next === Number(draft) ? '' : `Quantity adjusted to ${next}.`);
    setDraft(null);
  };
  const handleIncrement = () => {
    setDraft(null);
    setMessage('');
    onValidityChange?.(true);
    if (quantity < max) {
      onQuantityChange(quantity + 1);
    }
  };

  const handleDecrement = () => {
    setDraft(null);
    setMessage('');
    onValidityChange?.(true);
    if (quantity > min) {
      onQuantityChange(quantity - 1);
    }
  };

  const buttonClassName = 'h-11 min-h-11 w-11 min-w-11 rounded-[calc(var(--radius-control)-1px)] p-0';

  return (
    <div className="inline-flex max-w-full flex-col gap-1">
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
      
      <input id={inputId} type="text" inputMode="numeric" pattern="[0-9]*" aria-label="Quantity" aria-describedby={message ? `${inputId}-feedback` : undefined}
        aria-invalid={draft !== null && (!/^\d+$/.test(draft) || !Number.isSafeInteger(Number(draft)) || Number(draft) < min || Number(draft) > max)}
        data-form-control value={draft ?? String(quantity)} onChange={event => {
          const value = event.target.value;
          const valid = /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
          setDraft(value);
          setMessage('');
          onValidityChange?.(valid);
          if (valid) onQuantityChange(Number(value));
        }} onBlur={commitDraft}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); commitDraft(); }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(null); setMessage(''); onValidityChange?.(true); }
          if (event.key === 'ArrowUp') { event.preventDefault(); handleIncrement(); }
          if (event.key === 'ArrowDown') { event.preventDefault(); handleDecrement(); }
        }}
        className="h-11 w-12 min-w-0 rounded-sm bg-transparent px-1 text-center text-base font-semibold tabular-nums focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring" />
      <output className="sr-only" aria-label="Selected quantity" aria-live="polite">{quantity}</output>
      
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
    {message && <p id={`${inputId}-feedback`} role="status" className="max-w-40 text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
