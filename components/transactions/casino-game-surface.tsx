import type { ReactNode } from 'react';
import { DialogContent, DialogDescription } from '@/components/ui/dialog';
import { GameDialogHeading } from './game-dialog-heading';

type CasinoGameSurfaceProps = {
  title: string;
  description: string;
  onClose: () => void;
  preventEscape: boolean;
  variant?: 'cards' | 'roulette';
  children: ReactNode;
};

/** One scroll owner keeps the heading, cards and sticky actions inside the visible viewport. */
export function CasinoGameSurface({ title, description, onClose, preventEscape, variant = 'cards', children }: CasinoGameSurfaceProps) {
  return (
    <DialogContent
      layout="game"
      hideCloseButton
      onPointerDownOutside={event => event.preventDefault()}
      onEscapeKeyDown={event => { if (preventEscape) event.preventDefault(); }}
      mobileMode="center"
      surface="game"
      padding={variant === 'roulette' ? 'compact' : 'none'}
      size={variant === 'roulette' ? 'full' : undefined}
      className={variant === 'roulette'
        ? "casino-dialog-surface w-[min(96vw,60rem)] border-white/15 bg-[url('/icons/casino-bg.webp')] bg-cover bg-center bg-no-repeat text-white"
        : "blackjack-dialog-surface w-[min(96vw,34rem)] border-white/15 bg-[url('/icons/casinobj-bg.webp')] bg-cover bg-center bg-no-repeat text-white"}
    >
      <GameDialogHeading title={title} onClose={onClose} />
      <DialogDescription className="sr-only">{description}</DialogDescription>
      {children}
    </DialogContent>
  );
}
