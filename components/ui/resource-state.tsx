"use client";

import { Button } from './button';
import { cn } from '@/lib/utils';

/** Unknown data is not an empty collection. Every failed read has a way back. */
export function ResourceState({ status, title, description, onRetry, className }: {
  status: 'loading' | 'error' | 'empty';
  title: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role={status === 'error' ? 'alert' : 'status'} className={cn('space-y-2 rounded-[var(--radius-control)] border border-border bg-muted/30 p-4 text-sm', className)}>
      <p className="font-medium">{title}</p>
      {description && <p className="text-muted-foreground">{description}</p>}
      {status === 'error' && onRetry && <Button variant="outline" onClick={onRetry}>Retry</Button>}
    </div>
  );
}
