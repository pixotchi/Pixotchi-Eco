"use client";

import { useId, type ReactNode } from 'react';
import { Input, type InputProps } from './input';
import { Button } from './button';
import { cn } from '@/lib/utils';

export interface AmountFieldProps extends Omit<InputProps, 'size'> {
  label: string;
  unit: string;
  balance?: ReactNode;
  error?: string;
  hint?: ReactNode;
  onMax?: () => void;
  maxDisabled?: boolean;
  maxLabel?: string;
  surface?: 'default' | 'game';
  containerClassName?: string;
}

/** Owns label, unit, Max and associated feedback; callers own amount parsing. */
export function AmountField({ id, label, unit, balance, error, hint, onMax, maxDisabled, maxLabel, surface = 'default', containerClassName, className, ...input }: AmountFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const descriptionId = `${fieldId}-description`;
  const hasDescription = Boolean(error || hint || balance != null);
  return (
    <div className={cn('min-w-0 space-y-2', surface === 'game' && 'text-white', containerClassName)}>
      <label htmlFor={fieldId} className="block text-sm font-medium">{label} <span className={surface === 'game' ? 'text-white/75' : 'text-muted-foreground'}>({unit})</span></label>
      <div className="flex items-stretch gap-2">
        <Input {...input} id={fieldId} inputMode={input.inputMode ?? 'decimal'} autoComplete="off"
          aria-invalid={Boolean(error) || input['aria-invalid']}
          aria-describedby={[input['aria-describedby'], hasDescription ? descriptionId : undefined].filter(Boolean).join(' ') || undefined}
          className={cn('min-w-0 flex-1 tabular-nums', surface === 'game' && 'border-white/25 !bg-black/55 !text-white placeholder:text-white/60 caret-white selection:bg-white/20 focus-visible:!border-white/60 focus-visible:!ring-white/40 focus-visible:!ring-offset-0', error && (surface === 'game' ? 'border-red-300' : 'border-destructive'), className)} />
        {onMax && <Button type="button" variant="outline" onClick={onMax} disabled={input.disabled || maxDisabled} aria-label={maxLabel ?? `Use maximum ${unit}`}>Max</Button>}
      </div>
      {hasDescription && <div id={descriptionId} className={cn('space-y-1 text-xs leading-relaxed', surface === 'game' ? 'text-white/75' : 'text-muted-foreground')}>
        {balance != null && <p>Available: {balance} {unit}</p>}
        {error ? <p role="alert" className={surface === 'game' ? 'text-red-200' : 'text-destructive'}>{error}</p> : hint}
      </div>}
    </div>
  );
}
