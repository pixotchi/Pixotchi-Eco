'use client';

import { forwardRef, type HTMLAttributes } from 'react';
import { useScrollFade } from '@/hooks/useScrollFade';
import { cn } from '@/lib/utils';

/** A single scroll owner; feature classes retain overflow and sizing policy. */
export const ScrollArea = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function ScrollArea({ className, ...props }, forwardedRef) {
  const ref = useScrollFade(forwardedRef);
  return <div {...props} ref={ref} className={cn('surface-scroll-fade', className)} />;
});
