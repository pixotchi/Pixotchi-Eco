"use client";

import { useState, type ReactNode } from 'react';
import { rememberSurfaceOrigin } from '@/lib/motion';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

/** Review over the catalog without scrolling it or changing layout across breakpoints. */
export function PlantCareLayout({ selectionKey, reviewRequest, reviewTitle = 'Care item review', catalog, details }: {
  selectionKey: string | null;
  reviewRequest: number;
  reviewTitle?: ReactNode;
  catalog: ReactNode;
  details: ReactNode;
}) {
  // Remounting after a plant/wallet change must not replay an old selection.
  const [dismissedRequest, setDismissedRequest] = useState(reviewRequest);
  const open = Boolean(selectionKey && reviewRequest > dismissedRequest);
  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen) setDismissedRequest(reviewRequest); }}>
      <div className="min-w-0" onClickCapture={event => { const tile = (event.target as HTMLElement).closest('button'); if (tile) rememberSurfaceOrigin(tile, event.detail > 0); }}>{catalog}</div>
      <DialogContent size="md" layout="detail" mobileMode="sheet" morphFromTrigger>
        <DialogHeader>
          <DialogTitle>{reviewTitle}</DialogTitle>
          <DialogDescription>Review the effect and total cost before buying.</DialogDescription>
        </DialogHeader>
        <DialogBody>{details}</DialogBody>
      </DialogContent>
    </Dialog>
  );
}
