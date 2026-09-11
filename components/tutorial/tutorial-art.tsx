'use client';

import Image from 'next/image';
import { useState } from 'react';
import { ZoomIn } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import type { TutorialSlide } from './slides';

const descriptions: Record<NonNullable<TutorialSlide['art']>, string> = {
  'mint-plant': 'Mint → Plants: choose a strain. The second phone shows your plant in Farm.',
  'token-flow': 'Swap tab: choose ETH to sell and SEED to buy, then review the amount.',
  'plant-items': 'Farm → Plants → Plant care: select Water, then review its cost and lifetime effect before buying.',
  ptstod: 'Farm → Plants: points appear above your plant and remaining lifetime appears below it.',
  attack: 'Ranking shows attack options. Farm → Plant care → Fence shows protection duration and cost.',
  land: 'Farm → Lands: view your plot and open its map.',
  buildings: 'Farm → Lands → Buildings: choose Village for production or Town for services.',
  staking: 'Stake in the header opens the SEED staking dialog and your unclaimed LEAF.',
  chat: 'The header Chat button opens Public chat and the AI tab for Neural Seed.',
  tasks: 'Tasks in the header opens daily progress, Rocks and actions for each task.',
  base: 'Settings contains Tutorial, Documentation and Feedback. Return to Farm to keep growing.',
};

export function tutorialArtSrc(type: NonNullable<TutorialSlide['art']>) {
  return `/tutorial/current/${type}.webp`;
}

/** Phone mockups contain captured production UI and original repository assets. */
export function TutorialArt({ type }: { type?: TutorialSlide['art'] }) {
  const [expanded, setExpanded] = useState(false);
  if (!type) return null;
  return <>
    <button type="button" onClick={() => setExpanded(true)} aria-label="Enlarge tutorial screenshot"
      className="relative block aspect-[8/5] w-full cursor-zoom-in overflow-hidden rounded-panel border border-border/40 bg-[#abc8e6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      <Image key={type} src={tutorialArtSrc(type)} alt={descriptions[type]}
        width={1440} height={900} unoptimized loading="eager" className="h-full w-full object-contain" />
      <span aria-hidden="true" className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-foreground"><ZoomIn className="h-4 w-4" /></span>
    </button>
    <Dialog open={expanded} onOpenChange={setExpanded}>
      <DialogContent layer="nested" data-tutorial-image-viewer="" className="max-w-5xl gap-3">
        <DialogHeader><DialogTitle>Tutorial screenshot</DialogTitle>
          <DialogDescription>{descriptions[type]}</DialogDescription></DialogHeader>
        <div role="region" aria-label="Enlarged tutorial screenshot" tabIndex={0} className="min-h-0 overflow-auto overscroll-contain rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Image src={tutorialArtSrc(type)} alt={descriptions[type]} width={1440} height={900}
            unoptimized className="h-auto w-full min-w-[960px]" />
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
