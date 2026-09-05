"use client";

import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Rare recovery controls stay behind an explicit choice, outside normal status copy. */
export function TransactionRecoveryOptions({
  onContinue,
  disabled = false,
  description = 'Already completed or canceled in your wallet? You can continue. If it’s still pending, wait to avoid repeating the action.',
  className,
}: {
  onContinue: () => void;
  disabled?: boolean;
  description?: string;
  className?: string;
}) {
  return (
    <details className={cn('group min-w-0 open:basis-full', className)}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        More options
        <ChevronDown className="h-3.5 w-3.5 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="px-2.5 pb-1">
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
        <Button
          type="button"
          variant="outline"
          size="touchCompact"
          className="mt-2 rounded-lg bg-none text-xs shadow-none"
          onClick={onContinue}
          disabled={disabled}
        >
          Continue
        </Button>
      </div>
    </details>
  );
}
