"use client";

import type { ReactNode } from 'react';
import { Button } from './button';

/** Navigation to one existing review/controller; never a second submit button. */
export function ReviewActionBar({ title, detail, onReview, disabled }: { title: string; detail: ReactNode; onReview: () => void; disabled?: boolean }) {
  return <aside aria-label="Mint review shortcut" className="sticky top-0 z-20 flex items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-border bg-card p-3 shadow-[var(--shadow-hairline)] tablet:hidden">
    <div className="min-w-0"><p className="text-sm font-semibold">{title}</p><p className="break-words text-xs leading-relaxed text-muted-foreground">{detail}</p></div>
    <Button type="button" variant="outline" size="touchCompact" onClick={onReview} disabled={disabled}>Review</Button>
  </aside>;
}
