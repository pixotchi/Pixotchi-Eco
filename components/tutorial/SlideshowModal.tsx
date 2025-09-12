"use client";

import { useEffect } from "react";
import { useSlideshow } from "./SlideshowProvider";
import { Button } from "@/components/ui/button";
import Image from "next/image";

function Art({ type }: { type?: string }) {
  if (!type) return null;
  const map: Record<string, { src: string; alt: string }> = {
    "token-flow": { src: "/tutorial/swap.png", alt: "Swap ETH to SEED" },
    "mint-plant": { src: "/tutorial/mint-plant.png", alt: "Mint and feed plant" },
    "ptstod": { src: "/tutorial/ptstod.png", alt: "PTS and TOD" },
    "plant-items": { src: "/tutorial/plant-items.png", alt: "Plant Items Marketplace" },
    "attack": { src: "/tutorial/attack.png", alt: "Attack rules" },
    "land": { src: "/tutorial/mint-land.png", alt: "Mint land" },
    "buildings": { src: "/tutorial/buildings.png", alt: "Buildings production" },
    "staking": { src: "/tutorial/stake.png", alt: "Staking to earn LEAF" },
    "chat": { src: "/tutorial/chat.png", alt: "Chat and AI assistant" },
    "base": { src: "/tutorial/based.png", alt: "Use Smart Wallet in the Base app" },
    "tasks": { src: "/tutorial/tasks.png", alt: "Streaks & Farmer's Tasks" },
  };
  const art = map[type];
  if (!art) return null;
  return (
    <div key={type} className="w-full flex items-center justify-center">
      <div className="w-[90%] max-w-[360px] aspect-[16/10] rounded-xl bg-card/70 border border-border overflow-hidden shadow-md">
        <Image
          key={art.src}
          src={art.src}
          alt={art.alt}
          width={720}
          height={450}
          priority
          className="w-full h-full object-cover transition-opacity duration-300"
          onError={(e: any) => { try { (e.target as HTMLImageElement).style.display = 'none'; } catch {} }}
        />
      </div>
    </div>
  );
}

export default function SlideshowModal() {
  const { open, index, slides, next, prev, close } = useSlideshow();

  // Preload neighbor slide images for smoother transitions
  useEffect(() => {
    if (!open) return;
    const map: Record<string, string> = {
      "token-flow": "/tutorial/swap.png",
      "mint-plant": "/tutorial/mint-plant.png",
      "ptstod": "/tutorial/ptstod.png",
      "plant-items": "/tutorial/plant-items.png",
      "attack": "/tutorial/attack.png",
      "land": "/tutorial/mint-land.png",
      "buildings": "/tutorial/buildings.png",
      "staking": "/tutorial/stake.png",
      "chat": "/tutorial/chat.png",
      "base": "/tutorial/based.png",
      "tasks": "/tutorial/tasks.png",
    };
    const preload = (art?: string) => {
      const src = art ? map[art] : undefined;
      if (!src) return;
      const img = new window.Image();
      img.src = src;
    };
    const current = slides[index] as any;
    const prevSlide = slides[index - 1] as any;
    const nextSlide = slides[index + 1] as any;
    preload(prevSlide?.art);
    preload(nextSlide?.art);
  }, [open, index, slides]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, prev, close]);

  if (!open) return null;
  const slide = slides[index];
  const isLast = index === slides.length - 1;

  return (
    <div className="fixed inset-0 z-[11000] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md h-auto max-h-[90dvh] bg-background border border-border rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border bg-card/80 backdrop-blur-sm flex items-center justify-between safe-area-top">
          <div className="flex items-center gap-2">
            <Image src="/PixotchiKit/Logonotext.svg" alt="Pixotchi" width={20} height={20} />
            <span className="font-pixel text-sm">PIXOTCHI MINI</span>
          </div>
          <button onClick={close} className="text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background rounded-md px-2 py-1">Skip</button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 safe-area-inset max-h-[65vh] overflow-y-auto">
          <div className="flex items-start gap-3">
            {slide.icon}
            <h2 className="text-lg font-semibold leading-tight">{slide.title}</h2>
          </div>
          <Art type={slide.art} />
          <div className="text-foreground transition-opacity duration-300">{slide.content}</div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border bg-card/80 backdrop-blur-sm safe-area-bottom sticky bottom-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              {slides.map((_, i) => (
                <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? "w-6 bg-primary" : "w-2 bg-muted"}`} />
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
      </div>
    </div>
  );
}


