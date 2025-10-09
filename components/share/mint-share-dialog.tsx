"use client";

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { StrainVisual } from "@/lib/strains";

type ShareContext = "miniapp" | "web";

interface MintShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strainVisual: StrainVisual;
  tokenId?: number;
  shareUrl: string;
  shareText: string;
  shareContext: ShareContext;
  onShareMiniApp?: () => Promise<void> | void;
  onShareTwitter?: () => Promise<void> | void;
}

export default function MintShareDialog(props: MintShareDialogProps) {
  const {
    open,
    onOpenChange,
    strainVisual,
    tokenId,
    shareUrl,
    shareText,
    shareContext,
    onShareMiniApp,
    onShareTwitter,
  } = props;

  const footerCta = shareContext === "miniapp" ? "Share to Farcaster" : "Share on X";
  const footerHandler = shareContext === "miniapp" ? onShareMiniApp : onShareTwitter;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <div
          className="relative px-5 pt-5 pb-0 text-white"
          style={{
            background: `linear-gradient(135deg, ${strainVisual.gradient[0]}, ${strainVisual.gradient[1]})`,
          }}
        >
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="text-2xl font-semibold">
              {strainVisual.emoji} Plant Minted!
            </DialogTitle>
            <DialogDescription className="text-white/80">
              Your {strainVisual.displayName} is ready. Share this moment with your friends.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-3 pt-4 pb-6">
            <div className="flex-1">
              <div className="text-sm uppercase tracking-wide text-white/70">Strain</div>
              <div className="text-lg font-bold">{strainVisual.displayName}</div>
              {tokenId !== undefined && (
                <div className="text-sm text-white/80">Token #{tokenId}</div>
              )}
            </div>
            <div className="relative h-24 w-24 rounded-xl border border-white/40 bg-white/20 p-2 backdrop-blur">
              <Image
                src={strainVisual.image}
                alt={strainVisual.displayName}
                fill
                className="object-contain"
              />
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="rounded-lg border border-border bg-muted/60 p-3">
            <p className="text-sm text-muted-foreground">
              {strainVisual.tagline}
            </p>
          </div>

          <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-sm">
            <div className="text-xs uppercase text-muted-foreground mb-1">Share text</div>
            <p className="font-medium text-foreground leading-relaxed">{shareText}</p>
            <p className="mt-1 text-xs text-muted-foreground break-all">{shareUrl}</p>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Maybe later
            </Button>
            <Button
              className={cn(
                "bg-foreground text-background hover:bg-foreground/90",
              )}
              onClick={async () => {
                await footerHandler?.();
              }}
            >
              {footerCta}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


