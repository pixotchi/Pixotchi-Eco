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
import { Copy, Share2 } from "lucide-react";
import Image from "next/image";
import { useFrameContext } from "@/lib/frame-context";
import { useComposeCast } from "@coinbase/onchainkit/minikit";
import { toast } from "react-hot-toast";
import { openExternalUrl } from "@/lib/open-external";

interface MintShareData {
  address: string;
  basename?: string;
  strainName: string;
  strainId: number;
  mintedAt: string;
  txHash?: string;
}

interface MintShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: MintShareData | null;
}

const OG_BASE = process.env.NEXT_PUBLIC_URL || "https://mini.pixotchi.tech";

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
        // Fallback to long URL if short URL generation fails
        const url = new URL("/share/mint", OG_BASE);
        url.searchParams.set("address", data.address);
        url.searchParams.set("strain", String(data.strainId));
        url.searchParams.set("name", data.strainName);
        url.searchParams.set("mintedAt", data.mintedAt);
        if (data.txHash) url.searchParams.set("tx", data.txHash);
        setShortUrl(url.toString());
      }
    } catch (error) {
      console.error("Failed to generate short URL:", error);
      // Fallback to long URL
      const url = new URL("/share/mint", OG_BASE);
      url.searchParams.set("address", data.address);
      url.searchParams.set("strain", String(data.strainId));
      url.searchParams.set("name", data.strainName);
      url.searchParams.set("mintedAt", data.mintedAt);
      if (data.txHash) url.searchParams.set("tx", data.txHash);
      setShortUrl(url.toString());
    } finally {
      setIsGeneratingUrl(false);
    }
  }, [data, shortUrl]);

  // Generate short URL when modal opens
  if (open && data && !shortUrl && !isGeneratingUrl) {
    generateShortUrl();
  }

  const shareUrl = shortUrl;

  const tweetUrl = useMemo(() => {
    if (!data) return "";
    const tweet = new URL("https://twitter.com/intent/tweet");
    const text = `🌱 Just minted a ${data.strainName} in Pixotchi Mini! Grow with me on Base.`;
    tweet.searchParams.set("text", text);
    if (shareUrl) tweet.searchParams.set("url", shareUrl);
    return tweet.toString();
  }, [data, shareUrl]);

  const handleCopyLink = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Share link copied");
    } catch (error) {
      console.warn("Copy failed", error);
      toast.error("Failed to copy link");
    }
  }, [shareUrl]);

  const handleMiniAppShare = useCallback(async () => {
    if (!data || !shareUrl) return;
    setIsSharing(true);
    try {
      await composeCast({
        text: `🌱 I just minted a ${data.strainName} in Pixotchi Mini!`,
        embeds: [shareUrl],
      });
      toast.success("Share composer opened");
      onOpenChange(false);
    } catch (error) {
      console.warn("Compose cast failed", error);
      toast.error("Unable to open Farcaster composer");
    } finally {
      setIsSharing(false);
    }
  }, [composeCast, data, onOpenChange, shareUrl]);

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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center">Share your mint</DialogTitle>
          <DialogDescription className="text-center">
            Celebrate your new plant with friends!
          </DialogDescription>
        </DialogHeader>

        {data ? (
          <div className="space-y-6">
            {/* Plant Image and Name */}
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-32 h-32 flex items-center justify-center">
                <Image
                  src={PLANT_IMAGES[data.strainId] || PLANT_IMAGES[1]}
                  alt={data.strainName}
                  width={128}
                  height={128}
                  className="object-contain"
                />
              </div>
              <div className="text-xl font-bold text-center">{data.strainName}</div>
            </div>

            {/* Share Buttons */}
            <div className="space-y-3">
              {isMiniApp ? (
                <Button
                  className="w-full"
                  onClick={handleMiniAppShare}
                  disabled={isSharing || isGeneratingUrl || !shareUrl}
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  {isGeneratingUrl ? "Generating link..." : "Share"}
                </Button>
              ) : (
                <Button 
                  className="w-full" 
                  onClick={handleTwitterShare}
                  disabled={isGeneratingUrl || !shareUrl}
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  {isGeneratingUrl ? "Generating link..." : "Share"}
                </Button>
              )}

              <Button 
                variant="outline" 
                className="w-full" 
                onClick={handleCopyLink}
                disabled={isGeneratingUrl || !shareUrl}
              >
                <Copy className="w-4 h-4 mr-2" />
                {isGeneratingUrl ? "Generating..." : "Copy share link"}
              </Button>
            </div>

            {shareUrl && !isGeneratingUrl && (
              <div className="text-xs text-muted-foreground text-center font-mono bg-muted p-2 rounded">
                {shareUrl.replace('https://', '')}
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

