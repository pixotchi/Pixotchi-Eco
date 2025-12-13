"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import Image from "next/image";
import { openExternalUrl } from "@/lib/open-external";

interface CreatorCoinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreatorCoinDialog({ open, onOpenChange }: CreatorCoinDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md border-primary/20 bg-card/95 backdrop-blur-xl">
        <DialogHeader className="items-center text-center space-y-4 pt-4 pr-0">
          <div className="relative w-24 h-24 flex items-center justify-center" style={{ perspective: '1000px' }}>
            <div className="relative w-24 h-24 animate-coin-flip" style={{ transformStyle: 'preserve-3d' }}>
              {/* Front Face */}
              <div className="absolute inset-0" style={{ transform: 'translateZ(1px)' }}>
                <Image 
                  src="/icons/cc.png" 
                  alt="Creator Coin" 
                  width={96} 
                  height={96}
                  className="w-full h-full object-contain drop-shadow-lg"
                />
              </div>
              {/* Back Face */}
              <div className="absolute inset-0" style={{ transform: 'translateZ(-1px) rotateY(180deg)' }}>
                <Image 
                  src="/icons/cc.png" 
                  alt="Creator Coin" 
                  width={96} 
                  height={96}
                  className="w-full h-full object-contain drop-shadow-lg"
                />
              </div>
            </div>
          </div>
          <DialogTitle className="text-2xl font-pixel tracking-wide text-primary">
            $PIXOTCHI Launch
          </DialogTitle>
          <DialogDescription className="text-foreground text-lg font-medium">
            16th of December, 17:00 UTC
            <br/>
            on{" "}
            <button 
              type="button"
              onClick={() => openExternalUrl("https://zora.co/@pixotchi/")}
              className="text-primary hover:underline underline-offset-4 bg-transparent border-0 p-0 cursor-pointer inline font-medium"
            >
              Zora
            </button>
          </DialogDescription>
          <button 
            type="button"
            onClick={() => openExternalUrl("https://doc.pixotchi.tech/tokens/pixotchi-token")}
            className="text-xs text-primary hover:underline underline-offset-4 bg-transparent border-0 p-0 cursor-pointer"
          >
            Learn more
          </button>
        </DialogHeader>

        <div className="space-y-6 pt-2 pb-4">
          <div className="p-4 rounded-xl bg-muted/40 border border-border/50 text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              Get ready for the official Creator Coin launch!
              <br/>
              This message is only visible to the players who hold in-game assets.
            </p>
          </div>

          <div className="pt-2 border-t border-border/30">
            <p className="text-xs text-muted-foreground leading-relaxed text-center opacity-80">
              <span className="font-semibold block mb-1">Disclaimer:</span>
              $PIXOTCHI Creator Coin is a utility and governance token for the Pixotchi ecosystem. It does not represent an investment contract or financial advice. Token value may fluctuate significantly. Please consult your local laws regarding token ownership in your jurisdiction.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

