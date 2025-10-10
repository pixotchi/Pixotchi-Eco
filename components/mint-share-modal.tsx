"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Copy, Share2, Sparkles, Twitter } from "lucide-react";
import { useFrameContext } from "@/lib/frame-context";
import { useComposeCast } from "@coinbase/onchainkit/minikit";
import { toast } from "react-hot-toast";
import { openExternalUrl } from "@/lib/open-external";

interface MintShareData {
  address: string;
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

export function MintShareModal({ open, onOpenChange, data }: MintShareModalProps) {
  const frame = useFrameContext();
  const { composeCast } = useComposeCast();
  const [isSharing, setIsSharing] = useState(false);

  const isMiniApp = Boolean(frame?.isInMiniApp);

  const shareUrl = useMemo(() => {
    if (!data) return "";
    const url = new URL("/share/mint", OG_BASE);
    url.searchParams.set("address", data.address);
    url.searchParams.set("strain", String(data.strainId));
    url.searchParams.set("name", data.strainName);
    url.searchParams.set("mintedAt", data.mintedAt);
    if (data.txHash) url.searchParams.set("tx", data.txHash);
    return url.toString();
  }, [data]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Share your mint
          </DialogTitle>
          <DialogDescription>
            Celebrate your new plant with friends. Sharing helps others discover Pixotchi Mini.
          </DialogDescription>
        </DialogHeader>

        {data ? (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>
                <div className="font-semibold">{data.strainName}</div>
                <div className="text-xs text-muted-foreground">
                  Minted on {new Date(data.mintedAt).toLocaleString()}
                </div>
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              {isMiniApp ? (
                <Button
                  className="w-full"
                  onClick={handleMiniAppShare}
                  disabled={isSharing}
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  Share on Farcaster
                </Button>
              ) : (
                <Button className="w-full" onClick={handleTwitterShare}>
                  <Twitter className="w-4 h-4 mr-2" />
                  Share on X
                </Button>
              )}

              <Button variant="outline" className="w-full" onClick={handleCopyLink}>
                <Copy className="w-4 h-4 mr-2" />
                Copy share link
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Mint data unavailable. Try minting again to share your plant.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Maybe later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

