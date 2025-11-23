"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Share2, Sparkles } from "lucide-react";
import Image from "next/image";
import { useFrameContext } from "@/lib/frame-context";
import { useComposeCast } from "@coinbase/onchainkit/minikit";
import { toast } from "react-hot-toast";
import { openExternalUrl } from "@/lib/open-external";
import type { MintShareData } from "@/lib/types";

interface MintShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: MintShareData | null;
}

// Plant images matching strain IDs
const PLANT_IMAGES: Record<number, string> = {
  1: '/icons/plant1.svg',   // Flora
  2: '/icons/plant2.svg',   // Taki
  3: '/icons/plant3WithFrame.svg',  // Rosa
  4: '/icons/plant4WithFrame.svg',  // Zest
  5: '/icons/plant5.png',   // TYJ
};

export function MintShareModal({ open, onOpenChange, data }: MintShareModalProps) {
  const frame = useFrameContext();
  const { composeCast } = useComposeCast();
  const [isSharing, setIsSharing] = useState(false);
  const [shortUrl, setShortUrl] = useState<string>("");
  const [isGeneratingUrl, setIsGeneratingUrl] = useState(false);

  const isMiniApp = Boolean(frame?.isInMiniApp);

  // Generate short URL when modal opens with data
  const generateShortUrl = useCallback(async () => {
    if (!data || shortUrl) return;
    
    setIsGeneratingUrl(true);
    try {
      const response = await fetch("/api/share/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: data.address,
          basename: data.basename,
          strain: String(data.strainId),
          name: data.strainName,
          mintedAt: data.mintedAt,
          tx: data.txHash,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setShortUrl(result.shortUrl);
      } else {
        console.error("Failed to generate short URL - server returned error");
        toast.error("Unable to generate share link");
      }
    } catch (error) {
      console.error("Failed to generate short URL:", error);
      toast.error("Unable to generate share link");
    } finally {
      setIsGeneratingUrl(false);
    }
  }, [data, shortUrl]);

  // Generate short URL when modal opens
  if (open && data && !shortUrl && !isGeneratingUrl) {
    generateShortUrl();
  }

  const shareUrl = shortUrl;

  // Enhanced share text with engaging copy
  const shareText = useMemo(() => {
    if (!data) return "";
    
    return isMiniApp
      ? `🪴 Just planted a ${data.strainName} in Pixotchi Mini!\n\nJoin me, grow your own plants and earn ETH rewards! 🟦`
      : `🪴 Just planted a ${data.strainName} on @baseapp!\n\nGrowing onchain with @pixotchi 🌿\n\nStart your farming journey and earn ETH rewards! 🟦`;
  }, [data, isMiniApp]);

  const tweetUrl = useMemo(() => {
    if (!data) return "";
    const tweet = new URL("https://x.com/intent/tweet");
    tweet.searchParams.set("text", shareText);
    if (shareUrl) tweet.searchParams.set("url", shareUrl);
    return tweet.toString();
  }, [data, shareUrl, shareText]);

  const handleCopyLink = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Share link copied! 🎉");
    } catch (error) {
      console.warn("Copy failed", error);
      // Fallback: try to select the text for manual copy
      try {
        const urlElement = document.querySelector('[data-share-url]') as HTMLInputElement;
        if (urlElement) {
          urlElement.select();
          toast.error("Clipboard unavailable - text selected for manual copy");
        } else {
          toast.error("Failed to copy link");
        }
      } catch {
        toast.error("Failed to copy link");
      }
    }
  }, [shareUrl]);

  const handleMiniAppShare = useCallback(async () => {
    if (!data || !shareUrl) return;
    setIsSharing(true);
    try {
      await composeCast({
        text: shareText,
        embeds: [shareUrl],
      });
      toast.success("Share composer opened");
      onOpenChange(false);
    } catch (error) {
      console.warn("Compose cast failed", error);
      toast.error("Unable to open Farcaster composer - try copying the link instead");
    } finally {
      setIsSharing(false);
    }
  }, [composeCast, data, onOpenChange, shareUrl, shareText]);

  const handleTwitterShare = useCallback(async () => {
    if (!tweetUrl) return;
    if (isMiniApp) {
      await openExternalUrl(tweetUrl);
    } else {
      window.open(tweetUrl, "_blank", "noopener,noreferrer");
    }
    onOpenChange(false);
  }, [isMiniApp, onOpenChange, tweetUrl]);

  // Reset short URL when modal closes
  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (!newOpen) {
      setShortUrl("");
      setIsGeneratingUrl(false);
    }
    onOpenChange(newOpen);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" hideCloseButton>
        <DialogHeader>
          <DialogTitle className="text-center">Share your mint</DialogTitle>
          <DialogDescription className="text-center">
            Celebrate your new plant with friends!
          </DialogDescription>
        </DialogHeader>

        {data ? (
          <div className="space-y-6">
            {/* Plant Image and Name with celebration animation */}
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-32 h-32 flex items-center justify-center">
                {/* Celebration sparkles animation */}
                <div className="absolute inset-0 pointer-events-none">
                  <Sparkles 
                    className="absolute top-0 left-0 w-4 h-4 text-yellow-400 animate-pulse" 
                    style={{ animationDelay: '0s', animationDuration: '1.5s' }}
                  />
                  <Sparkles 
                    className="absolute top-2 right-2 w-5 h-5 text-yellow-300 animate-pulse" 
                    style={{ animationDelay: '0.3s', animationDuration: '2s' }}
                  />
                  <Sparkles 
                    className="absolute bottom-0 left-4 w-4 h-4 text-yellow-500 animate-pulse" 
                    style={{ animationDelay: '0.6s', animationDuration: '1.8s' }}
                  />
                  <Sparkles 
                    className="absolute bottom-4 right-0 w-3 h-3 text-yellow-400 animate-pulse" 
                    style={{ animationDelay: '0.9s', animationDuration: '2.2s' }}
                  />
                </div>
                
                {/* Subtle glow effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-green-400/10 via-transparent to-blue-400/10 rounded-full blur-xl animate-pulse" 
                  style={{ animationDuration: '3s' }}
                />
                
                <Image
                  src={PLANT_IMAGES[(data.strainId || 1) as keyof typeof PLANT_IMAGES] || PLANT_IMAGES[1]}
                  alt={`${data.strainName} plant`}
                  aria-label={`${data.strainName} strain plant illustration`}
                  width={128}
                  height={128}
                  className="object-contain relative z-10 animate-[bounce_1s_ease-in-out_3]"
                  priority
                />
              </div>
              <div className="text-xl font-bold text-center font-pixel">{data.strainName}</div>
            </div>

            {/* Share Buttons */}
            <div className="space-y-3">
              {isMiniApp ? (
                <Button
                  className="w-full"
                  onClick={handleMiniAppShare}
                  disabled={isSharing || isGeneratingUrl || !shareUrl}
                  aria-busy={isSharing || isGeneratingUrl}
                  aria-label={`Share your ${data.strainName} mint on Farcaster`}
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  {isGeneratingUrl ? "Generating link..." : "Share"}
                </Button>
              ) : (
                <Button 
                  className="w-full" 
                  onClick={handleTwitterShare}
                  disabled={isGeneratingUrl || !shareUrl}
                  aria-busy={isGeneratingUrl}
                  aria-label={`Share your ${data.strainName} mint on Twitter`}
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  {isGeneratingUrl ? "Generating link..." : "Share"}
                </Button>
              )}
            </div>

            {/* Share URL with inline copy button */}
            {shareUrl && !isGeneratingUrl && (
              <div className="relative">
                <input
                  readOnly
                  value={shareUrl.replace('https://', '')}
                  data-share-url
                  onFocus={(e) => e.target.select()}
                  className="w-full text-xs font-mono bg-muted text-muted-foreground p-3 pr-10 rounded border border-border/50 focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-text"
                  aria-label="Share link - click to select"
                />
                <button
                  onClick={handleCopyLink}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 hover:bg-background/80 rounded transition-colors"
                  aria-label="Copy share link to clipboard"
                  title="Copy link"
                >
                  <Copy className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
            )}

            <Button variant="ghost" className="w-full" onClick={() => handleOpenChange(false)}>
              Not now
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center">
            Mint data unavailable. Try minting again to share your plant.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

