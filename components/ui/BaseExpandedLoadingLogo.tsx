"use client";

import React from 'react';
import { cn } from '@/lib/utils';
import { BaseMark } from './base-mark';
import { useBaseMarkColors } from '@/hooks/useBaseMarkColors';

interface BaseExpandedLoadingLogoProps {
  className?: string;
  text?: string;
  size?: 'sm' | 'md' | 'lg';
}

function BaseExpandedLoadingLogo({ className, text, size = 'md' }: BaseExpandedLoadingLogoProps) {
  const boxColors = useBaseMarkColors(true);

  const sizeStyles = {
    sm: 'w-20 h-7',
    md: 'w-32 h-11', 
    lg: 'w-48 h-16',
  };

  const textSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };


  return (
    <div
      className={cn('flex flex-col items-center justify-center', className)}
      role="status"
      aria-live="polite"
    >
      <div className={cn('relative overflow-visible', sizeStyles[size])}>
        {/* Always show the expanded BASE mark; color changes stay deliberately calm. */}
        <BaseMark colors={boxColors} />
      </div>
      
      {text && (
        <p className={cn('mt-3 text-muted-foreground font-medium', textSizes[size])}>
          {text}
        </p>
      )}
      {!text && <span className="sr-only">Loading</span>}
    </div>
  );
}

export function BaseExpandedLoadingPageLoader({ text = "Loading..." }: { text?: string }) {
  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <BaseExpandedLoadingLogo size="lg" text={text} />
    </div>
  );
}
