"use client";

import { useEffect, useMemo } from "react";
import { useSlideshow } from "./SlideshowProvider";
import { slides as allSlides } from "./slides";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import Image from "next/image";
import type { SyntheticEvent } from "react";

/*
 * No manual image preloading here any more: the old `new window.Image()` pass
 * requested the RAW /tutorial/*.png files (0.4-0.6MB each) while the rendered
 * next/image below requests optimized /_next/image URLs — so the "preload"
 * warmed nothing and doubled ~1MB of downloads on every new user's first
 * screen. next/image's own `preload` on the current slide is sufficient.
 */
function Art({ type }: { type?: string }) {
  if (!type) return null;
  const map: Record<string, { src: string; alt: string }> = {
    "token-flow": { src: "/tutorial/swap.webp", alt: "Swap ETH to SEED" },
    "mint-plant": { src: "/tutorial/mint-plant.webp", alt: "Mint and feed plant" },
    "ptstod": { src: "/tutorial/ptstod.webp", alt: "PTS and TOD" },
    "plant-items": { src: "/tutorial/plant-items.webp", alt: "Plant Items Marketplace" },
    "attack": { src: "/tutorial/attack.webp", alt: "Attack rules" },
    "land": { src: "/tutorial/mint-land.webp", alt: "Mint land" },
    "buildings": { src: "/tutorial/buildings.webp", alt: "Buildings production" },
    "staking": { src: "/tutorial/stake.webp", alt: "Staking to earn LEAF" },
    "chat": { src: "/tutorial/chat.webp", alt: "Chat and AI assistant" },
    "base": { src: "/tutorial/based.webp", alt: "Use Smart Wallet in the Base app" },
    "tasks": { src: "/tutorial/tasks.webp", alt: "Streaks & Farmer's Tasks" },
  };
  const art = map[type];
  if (!art) return null;
  return (
    <div key={type} className="w-full flex items-center justify-center">
      <div className="aspect-[16/10] w-[90%] max-w-[360px] overflow-hidden rounded-[var(--radius-panel)] border border-[hsl(var(--edge-panel))] bg-card/70 shadow-[var(--shadow-hairline)]">
        {/* No transition-opacity: the element is keyed by src, so it remounts per
            slide and a transition can never interpolate — it was inert. */}
        <Image
          key={art.src}
          src={art.src}
          alt={art.alt}
          width={720}
          height={450}
          sizes="(max-width: 640px) 90vw, 360px"
          preload
          className="w-full h-full object-cover"
          onError={(event: SyntheticEvent<HTMLImageElement>) => {
            try {
              event.currentTarget.style.display = "none";
            } catch {}
          }}
        />
      </div>
    </div>
  );
}

export default function SlideshowModal() {
  const { open, index, slideIds, next, prev, close } = useSlideshow();
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
        useSafeAreaInset={false}
        overlayClassName="bg-black/50 backdrop-blur-[var(--blur-overlay)]"
        frameClassName="items-end sm:items-center justify-center p-0 sm:p-4"
        className="max-h-[90dvh] w-full max-w-md rounded-[var(--radius-dialog)] border border-[hsl(var(--edge-strong))] p-0 sm:p-0 shadow-[var(--shadow-modal)]"
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogTitle className="sr-only">Pixotchi tutorial: {slide.title}</DialogTitle>
        <DialogDescription className="sr-only">
          Step-by-step Pixotchi tutorial slide with navigation controls.
        </DialogDescription>
        {/* Header */}
        <div className="surface-header-divider dialog-header-surface flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Image src="/PixotchiKit/Logonotext.svg" alt="Pixotchi" width={20} height={20} />
            <span className="text-sm font-semibold">Tutorial</span>
          </div>
          <Button variant="ghost" size="default" onClick={close} className="px-3 text-sm text-muted-foreground hover:text-foreground">Skip</Button>
        </div>

        {/* Body (dvh, matching the panel's own cap — vh over-measures on mobile) */}
        <div className="surface-scroll-fade max-h-[65dvh] overflow-y-auto p-6 space-y-5">
          <div className="flex items-start gap-3">
            {slide.icon}
            <h2 className="text-lg font-semibold leading-tight">{slide.title}</h2>
          </div>
          <Art type={slide.art} />
          <div className="text-foreground">{slide.content}</div>
        </div>

        {/* Footer */}
        <div className="surface-footer-divider dialog-footer-surface px-4 py-3 safe-area-bottom">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              {/* Explicit property list (was transition-all with default easing). */}
              {slides.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-[width,background-color] duration-[var(--motion-quick)] ease-[var(--ease-standard)] ${
                    i === index ? "w-6 bg-primary" : "w-2 bg-muted"
                  }`}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={prev} disabled={index === 0}>Back</Button>
              {isLast ? (
                <Button onClick={close}>Done</Button>
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
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, prev]);
}
