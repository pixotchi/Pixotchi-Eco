"use client";

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Keep the catalog's geometry stable while one mounted review handles purchases. */
export function PlantCareLayout({ selectionKey, catalog, details }: {
  selectionKey: string | null;
  catalog: ReactNode;
  details: ReactNode;
}) {
  const review = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectionKey) return;
    // Changing quantity keeps the same key, so editing never pulls focus away.
    review.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    review.current?.focus({ preventScroll: true });
  }, [selectionKey]);
  return (
    <div className="flex flex-col gap-4">
      <div className="min-w-0">{catalog}</div>
      <div ref={review} role={selectionKey ? 'region' : undefined} aria-label={selectionKey ? 'Care item review' : undefined}
        tabIndex={selectionKey ? -1 : undefined} className={cn('min-w-0 scroll-my-4 rounded-[var(--radius-panel)] outline-none focus-visible:ring-2 focus-visible:ring-ring', !selectionKey && 'order-first')}>
        {details}
      </div>
    </div>
  );
}
