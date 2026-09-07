"use client";

import { X } from 'lucide-react';
import { DialogTitle } from '@/components/ui/dialog';

/** Transparent close row keeps dismissal clear of the first betting field. Features
 * retain their existing pending-game close guards through onClose. */
export function GameDialogHeading({ title, onClose }: { title: string; onClose: () => void }) {
  return <div className="pointer-events-none sticky -top-[var(--dialog-padding)] z-20 -mx-[var(--dialog-padding)] -mt-[var(--dialog-padding)] flex shrink-0 items-center justify-end px-3 py-2 text-white">
    <DialogTitle className="sr-only">{title}</DialogTitle>
    <button type="button" onClick={onClose} aria-label={`Close ${title} dialog`}
      className="pointer-events-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-white/20 bg-white/10 text-white [@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  </div>;
}
