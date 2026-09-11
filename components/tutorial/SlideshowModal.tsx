"use client";

import { useEffect, useMemo, useRef } from "react";
import { useSlideshow } from "./SlideshowProvider";
import { slides as allSlides } from "./slides";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import Image from "next/image";
import { TutorialArt, tutorialArtSrc } from "./tutorial-art";
import { ScrollArea } from '@/components/ui/scroll-area';
import { navigateToGameTab } from '@/lib/game-navigation';

export default function SlideshowModal() {
  const { open, index, mode, slideIds, next, prev, close, finish } = useSlideshow();
  const scrollRef = useRef<HTMLDivElement>(null);
  const slides = useMemo(
    () => allSlides.filter((slide) => slideIds.includes(slide.id)),
    [slideIds],
  );

  /*
   * Arrow-key navigation only. Escape is deliberately NOT handled here: Radix
   * already routes Escape through onOpenChange -> close(), and the old window
   * listener made close() run twice per press (double-persisting completion).
   */
  useEffectArrowKeys(open, next, prev);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' }); }, [index, mode]);
  // Warm the next illustration while the current step is being read.
  const nextArt = slides[index + 1]?.art;
  useEffect(() => {
    if (!open || !nextArt) return;
    const image = new window.Image();
    image.src = tutorialArtSrc(nextArt);
  }, [open, nextArt]);

  // No `if (!open) return null` before the Dialog: unmounting in the same
  // commit that open flips false skipped Radix's exit animation and the
  // tutorial snapped shut. Radix keeps the closed dialog out of the tree.
  const slide = slides[index];
  const isLast = index === slides.length - 1;
  if (!slide) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          close();
        }
      }}
    >
      <DialogContent
        hideCloseButton
        padding="none"
        useSafeAreaInset={false}
        overlayClassName="bg-black/50 backdrop-blur-[var(--blur-overlay)]"
        frameClassName="items-end sm:items-center justify-center p-0 sm:p-4"
        className="flex max-h-[90dvh] min-h-0 w-full max-w-md flex-col gap-0 overflow-hidden rounded-[var(--radius-dialog)] border border-[hsl(var(--edge-strong))] shadow-[var(--shadow-modal)]"
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogTitle className="sr-only">Pixotchi tutorial: {slide.title}</DialogTitle>
        <DialogDescription className="sr-only">
          {mode === 'quick' ? 'A three-step introduction to your first plant and care.' : 'The full Pixotchi game guide. Skip saves your place so you can resume from Settings.'}
        </DialogDescription>
        {/* Header */}
        <div className="surface-header-divider dialog-header-surface flex shrink-0 items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Image src="/PixotchiKit/Logonotext.svg" alt="Pixotchi" width={20} height={20} />
            <span className="text-sm font-semibold">{mode === 'quick' ? 'Quick start' : 'Game guide'}</span>
          </div>
          <Button variant="ghost" size="default" onClick={close} className="px-3 text-sm text-muted-foreground hover:text-foreground">Skip</Button>
        </div>

        {/* Fit each step's content; scroll only when it exceeds the viewport cap. */}
        <ScrollArea ref={scrollRef} className="min-h-0 flex-initial overflow-y-auto p-4 space-y-4">
          <div className="flex items-start gap-3">
            {slide.icon}
            <h2 className="text-lg font-semibold leading-tight">{slide.title}</h2>
          </div>
          <TutorialArt type={slide.art} />
          <div className="text-foreground">{slide.content}</div>
        </ScrollArea>

        {/* Footer */}
        <div className="surface-footer-divider dialog-footer-surface shrink-0 px-4 py-3 safe-area-bottom">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs tabular-nums" aria-live="polite" aria-atomic="true">Step {index + 1} of {slides.length}<span className="sr-only">: {slide.title}</span></p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={prev} disabled={index === 0}>Back</Button>
              {isLast ? (
                <Button onClick={() => { finish(); if (mode === 'quick') navigateToGameTab('dashboard'); }}>{mode === 'quick' ? 'Open my farm' : 'Done'}</Button>
              ) : (
                <Button onClick={next}>Next</Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function useEffectArrowKeys(open: boolean, next: () => void, prev: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('[data-tutorial-image-viewer]')) return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))) return;
      if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, prev]);
}
