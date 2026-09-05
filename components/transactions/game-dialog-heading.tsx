"use client";

import { X } from 'lucide-react';
import { DialogTitle } from '@/components/ui/dialog';

/** Dedicated chrome keeps dismissal clear of the first betting field. Features
 * retain their existing pending-game close guards through onClose. */
export function GameDialogHeading({ title, onClose }: { title: string; onClose: () => void }) {
  return <div className="sticky -top-[var(--dialog-padding)] z-20 -mx-[var(--dialog-padding)] -mt-[var(--dialog-padding)] flex shrink-0 items-center justify-between gap-3 border-b border-white/15 bg-slate-950 px-3 py-2 text-white">
    <DialogTitle className="min-w-0 break-words text-base leading-snug">{title}</DialogTitle>
    <button type="button" onClick={onClose} aria-label={`Close ${title} dialog`}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-white/20 bg-white/10 text-white [@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  </div>;
}
