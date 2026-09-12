"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
Dialog,
DialogContent,
DialogBody,
DialogFooter,
DialogDescription,
DialogHeader,
DialogTitle,
} from "@/components/ui/dialog";
import { useFrameContext } from "@/lib/frame-context";
import { openExternalUrl } from "@/lib/open-external";
import type { MintShareData } from "@/lib/types";
import { sdk } from "@farcaster/miniapp-sdk";
import { Copy,Share2,Sparkles } from "lucide-react";
import Image from "next/image";
import { useCallback,useEffect,useMemo,useRef,useState } from "react";
import { toast } from "react-hot-toast";
import { PLANT_ART_MAP } from '@/lib/constants';

interface MintShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: MintShareData | null;
}

const SHARE_LINK_RETRY_DELAYS_MS = [0, 750, 1500] as const;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function MintShareModal({ open, onOpenChange, data }: MintShareModalProps) {
  const frame = useFrameContext();
  const [isSharing, setIsSharing] = useState(false);
  const [shortUrl, setShortUrl] = useState<string>("");
  const [isGeneratingUrl, setIsGeneratingUrl] = useState(false);
  const [generationFailed, setGenerationFailed] = useState(false);
  const generationAttemptKeyRef = useRef<string | null>(null);

  const isMiniApp = Boolean(frame?.isInMiniApp);
  const fallbackShareUrl = useMemo(() => {
    if (typeof window !== "undefined" && window.location.origin) {
      return window.location.origin;
    }
    return "https://mini.pixotchi.tech";
  }, []);
  const shareRequestKey = useMemo(() => {
    if (!data) return null;
    return [
      data.address,
      data.strainId,
      data.mintedAt,
      data.txHash || "",
    ].join(":");
  }, [data]);

  // Generate short URL when modal opens with data
  const generateShortUrl = useCallback(async () => {
    if (!data || shortUrl) return;

    setIsGeneratingUrl(true);
    let errorMessage: string | null = null;

    try {
      for (const delayMs of SHARE_LINK_RETRY_DELAYS_MS) {
        if (delayMs > 0) await wait(delayMs);

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
          if (typeof result.shortUrl === "string" && result.shortUrl) {
            return result.shortUrl;
          }
        }

        console.error("Failed to generate short URL - server returned error");
      }
      errorMessage = "Unable to generate share link";
    } catch (error) {
      console.error("Failed to generate short URL:", error);
      errorMessage = "Unable to generate share link";
    } finally {
      setIsGeneratingUrl(false);
    }
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return "";
  }, [data, shortUrl]);

  useEffect(() => {
    if (!open || !data || !shareRequestKey) return;
    if (shortUrl || generationAttemptKeyRef.current === shareRequestKey) return;

    let cancelled = false;
    generationAttemptKeyRef.current = shareRequestKey;
    setGenerationFailed(false);

    void (async () => {
      try {
        const nextShortUrl = await generateShortUrl();
        if (!cancelled && nextShortUrl) {
          setShortUrl(nextShortUrl);
        }
      } catch (error) {
        if (cancelled) return;
        console.warn("Share link generation failed", error);
        setGenerationFailed(true);
        toast.error("Unable to generate share link");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data, generateShortUrl, open, shareRequestKey, shortUrl]);

  const canUseFallbackShareUrl = generationFailed && !shortUrl;
  const shareUrl = shortUrl || (canUseFallbackShareUrl ? fallbackShareUrl : "");

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
    if (!shortUrl) return;
    try {
      await navigator.clipboard.writeText(shortUrl);
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
  }, [shortUrl]);

  const handleMiniAppShare = useCallback(async () => {
    if (!data || !frame?.isInMiniApp) return;
    setIsSharing(true);
    try {
      await sdk.actions.composeCast({
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
  }, [data, frame?.isInMiniApp, onOpenChange, shareUrl, shareText]);

  const handleTwitterShare = useCallback(async () => {
    if (!tweetUrl) return;
    if (isMiniApp) {
      await openExternalUrl(tweetUrl);
    } else {
      window.open(tweetUrl, "_blank", "noopener,noreferrer");
    }
    onOpenChange(false);
  }, [isMiniApp, onOpenChange, tweetUrl]);

  // Reset on close via the `open` PROP, not only inside onOpenChange: when the
  // parent set open={false} programmatically, onOpenChange never fired, the
  // stale shortUrl survived, and the next mint showed the previous plant's
  // share link (the generation effect short-circuits on a truthy shortUrl).
  useEffect(() => {
    if (!open) {
      setShortUrl("");
      setIsGeneratingUrl(false);
      generationAttemptKeyRef.current = null;
      setGenerationFailed(false);
    }
  }, [open]);

  const handleOpenChange = useCallback((newOpen: boolean) => {
    onOpenChange(newOpen);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent layout="form" adaptiveScroll className="max-w-md" surface="soft" hideCloseButton>
        <DialogHeader className="pr-5 sm:pr-6">
          <DialogTitle>Share your mint</DialogTitle>
          <DialogDescription>
            Celebrate your new plant and invite friends to your farm.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
        {data ? (
          <div className="space-y-6">
            {/* Plant Image and Name with celebration animation */}
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-32 h-32 flex items-center justify-center">
                {/* Celebration sparkles: finite (6 pulses ≈ the bounce's length),
                    not infinite — five never-ending pulse layers incl. a blurred
                    gradient repainted this dialog for as long as it stayed open. */}
                <div className="absolute inset-0 pointer-events-none">
                  <Sparkles
                    className="absolute top-0 left-0 w-4 h-4 text-yellow-400 animate-[pulse_1.5s_ease-in-out_6]"
                    style={{ animationDelay: '0s' }}
                  />
                  <Sparkles
                    className="absolute top-2 right-2 w-5 h-5 text-yellow-300 animate-[pulse_2s_ease-in-out_4]"
                    style={{ animationDelay: '0.3s' }}
                  />
                  <Sparkles
                    className="absolute bottom-0 left-4 w-4 h-4 text-yellow-500 animate-[pulse_1.8s_ease-in-out_5]"
                    style={{ animationDelay: '0.6s' }}
                  />
                  <Sparkles
                    className="absolute bottom-4 right-0 w-3 h-3 text-yellow-400 animate-[pulse_2.2s_ease-in-out_4]"
                    style={{ animationDelay: '0.9s' }}
                  />
                </div>

                {/* Static glow: the blur-xl layer no longer pulses (a blurred
                    animating gradient is the expensive kind of decoration). */}
                <div className="absolute inset-0 bg-gradient-to-br from-green-400/10 via-transparent to-blue-400/10 rounded-full blur-xl" />

                <Image
                  src={PLANT_ART_MAP[(data.strainId || 1) as keyof typeof PLANT_ART_MAP] || PLANT_ART_MAP[1]}
                  alt={`${data.strainName} plant`}
                  aria-label={`${data.strainName} strain plant illustration`}
                  width={128}
                  height={128}
                  className="object-contain relative z-10 animate-[bounce_1s_ease-in-out_3]"
                  preload
                />
              </div>
              <div className="text-center text-xl font-pixel leading-tight">{data.strainName}</div>
            </div>

            {/* Share Buttons */}
            <div className="space-y-3">
              {isMiniApp ? (
                <Button
                  variant="special"
                  fullWidth
                  className="h-auto min-h-11 whitespace-normal px-[min(1rem,4vw)] leading-snug"
                  onClick={handleMiniAppShare}
                  disabled={isSharing || isGeneratingUrl || !shareUrl}
                  aria-busy={isSharing || isGeneratingUrl}
                  aria-label={`Share your ${data.strainName} mint on Farcaster`}
                >
                  <Share2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{isGeneratingUrl ? "Generating link..." : canUseFallbackShareUrl ? "Share app link" : "Share"}</span>
                </Button>
              ) : (
                <Button
                  variant="special"
                  fullWidth
                  className="h-auto min-h-11 whitespace-normal px-[min(1rem,4vw)] leading-snug"
                  onClick={handleTwitterShare}
                  disabled={isGeneratingUrl || !shareUrl}
                  aria-busy={isGeneratingUrl}
                  aria-label={`Share your ${data.strainName} mint on X`}
                >
                  <Share2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{isGeneratingUrl ? "Generating link..." : canUseFallbackShareUrl ? "Share app link" : "Share"}</span>
                </Button>
              )}
            </div>

            {/* Share URL with inline copy button */}
            {shortUrl && !isGeneratingUrl && (
              <div className="relative">
                <Input
                  readOnly
                  value={shortUrl.replace('https://', '')}
                  data-share-url
                  onFocus={(e) => e.target.select()}
                  className="cursor-text border-border/50 bg-muted pr-14 font-mono text-muted-foreground"
                  aria-label="Share link - click to select"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleCopyLink}
                  className="absolute right-0 top-0 text-muted-foreground hover:bg-background/80 hover:text-foreground"
                  aria-label="Copy share link to clipboard"
                  title="Copy link"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            )}

          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center">
            Your plant’s share details are unavailable. Close this window and find your existing plant in the Plants tab.
          </p>
        )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" fullWidth className="h-auto min-h-11 whitespace-normal leading-snug" onClick={() => handleOpenChange(false)}>
            {data ? 'Not now' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
