"use client";

import { useSlideshow } from "@/components/tutorial";
import { Button } from "@/components/ui/button";
import { CardContent, TabCard } from "@/components/ui/card";
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { BaseAnimatedLogo } from "@/components/ui/loading";
import { Textarea } from "@/components/ui/textarea";
import { useFrameContext } from "@/lib/frame-context";
import { openExternalUrl } from "@/lib/open-external";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import packageJson from '@/package.json';
import { MessageCircle,PlayCircle,Radio } from "lucide-react";
import { useId,useState } from "react";
import { toast } from 'react-hot-toast';
import { useAccount } from 'wagmi';

const XBrandIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="currentColor" role="img" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z" />
  </svg>
);

const TelegramBrandIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="#26A5E4" role="img" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  </svg>
);

const FarcasterBrandIcon = ({ className }: { className?: string }) => (
  <svg className={className} role="img" viewBox="0 0 1000 1000" aria-hidden="true">
    <path d="M257.778 155.556H742.222V844.445H671.111V528.889H670.414C662.554 441.677 589.258 373.333 500 373.333C410.742 373.333 337.446 441.677 329.586 528.889H328.889V844.445H257.778V155.556Z" fill="#855DCD" />
    <path d="M128.889 253.333L157.778 351.111H182.222V746.667C169.949 746.667 160 756.616 160 768.889V795.556H155.556C143.283 795.556 133.333 805.505 133.333 817.778V844.445H382.222V817.778C382.222 805.505 372.273 795.556 360 795.556H355.556V768.889C355.556 756.616 345.606 746.667 333.333 746.667H306.667V253.333H128.889Z" fill="#855DCD" />
    <path d="M675.556 746.667C663.283 746.667 653.333 756.616 653.333 768.889V795.556H648.889C636.616 795.556 626.667 805.505 626.667 817.778V844.445H875.556V817.778C875.556 805.505 865.606 795.556 853.333 795.556H848.889V768.889C848.889 756.616 838.94 746.667 826.667 746.667V351.111H851.111L880 253.333H702.222V746.667H675.556Z" fill="#855DCD" />
  </svg>
);

export default function AboutTab() {
  const feedbackTextId = useId();
  const feedbackHelpId = useId();
  const { address } = useAccount();
  const { start, enabled } = useSlideshow();
  const { walletType, isSmartWallet } = useSmartWallet();
  const frameData = useFrameContext();
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  // Note: Gamification streak/missions now handled by TasksInfoDialog component

  const submitFeedback = async () => {
    if (!address) {
      toast.error('Please connect your wallet first');
      return;
    }

    if (!feedbackText.trim()) {
      toast.error('Please enter your feedback');
      return;
    }

    if (feedbackText.trim().length < 10) {
      toast.error('Feedback must be at least 10 characters');
      return;
    }

    setFeedbackLoading(true);
    try {
      // Collect wallet profile data
      const isMiniApp = Boolean(frameData?.isInMiniApp);
      const fcContext = (frameData?.context as UntypedValue) ?? null;

      // Extract farcaster details
      let farcasterDetails: UntypedValue = null;
      if (isMiniApp && fcContext) {
        farcasterDetails = {
          fid: fcContext.user?.fid,
          username: fcContext.user?.username,
          displayName: fcContext.user?.displayName,
          clientType: fcContext.client?.platformType,
          referrerDomain: fcContext.location?.referrerDomain || fcContext.location?.referrer,
        };
      }

      const response = await fetch('/api/feedback/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          message: feedbackText.trim(),
          walletType,
          isSmartWallet,
          isMiniApp,
          farcasterDetails,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success('Thank you for your feedback!');
        setFeedbackText('');
        setShowFeedbackDialog(false);
      } else {
        toast.error(data.error || 'Failed to submit feedback');
      }
    } catch (error) {
      console.error('Feedback submission error:', error);
      toast.error('Failed to submit feedback');
    } finally {
      setFeedbackLoading(false);
    }
  };



  return (
    // The page is short by design. On desktop it centres in the pane so the
    // remaining space reads as deliberate breathing room rather than the content
    // having collapsed to the top of an empty screen.
    <div className="mx-auto w-full max-w-[36rem] lg:flex lg:min-h-[calc(100dvh-13rem)] lg:max-w-4xl lg:items-center xl:min-h-[calc(100dvh-9rem)]">

      <div className="w-full space-y-8 lg:grid lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:items-stretch lg:gap-5 lg:space-y-0">
      {/* Description */}
      <TabCard className="lg:h-full">
        {/* The gap lives on the container, not as a margin on the actions block:
            `mt-auto` absorbs free space, so when this card is the taller column
            (free space = 0) a margin there collapses and the rule would sit flush
            against the last line of prose. Flex `gap` is applied regardless. */}
        <CardContent className="flex h-full flex-col gap-6">
          {/* Capped measure: the prose would otherwise run the full column width
              on desktop and become hard to read. */}
          <div className="space-y-4 lg:max-w-[62ch]">
            <p className="leading-relaxed text-foreground/85">
              <span className="font-pixel text-foreground">PIXOTCHI</span> is a tamagotchi-style onchain game on Base where you mint, grow, and care for plants and lands while earning real ETH rewards. Keep your plants alive, increase their score, and compete on the global leaderboard.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Every player follows a different strategy. Some invest in Lands for long-term, passive growth, while others push their plants aggressively using the marketplace to climb rankings faster at a higher cost.
            </p>
          </div>

          {/* Actions sit against the bottom of the card so both columns end level. */}
          <div className="border-t border-border/55 pt-5 lg:mt-auto">
            <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:gap-2">
              {enabled && (
                <Button
                  variant="default"
                  onClick={() => start({ reset: true })}
                  className="lg:w-auto"
                  aria-label="Start Pixotchi tutorial"
                >
                  <PlayCircle className="w-4 h-4 mr-2" />
                  Tutorial
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => setShowFeedbackDialog(true)}
                className="lg:w-auto"
                aria-label="Open feedback dialog"
              >
                <MessageCircle className="w-4 h-4 mr-2" />
                Feedback
              </Button>
              <Button
                variant="outline"
                onClick={() => openExternalUrl('https://status.pixotchi.tech')}
                className={enabled ? "col-span-2 lg:col-span-1 lg:w-auto" : "lg:w-auto"}
                aria-label="Open Pixotchi status"
              >
                <Radio className="w-4 h-4 mr-2" />
                Status
              </Button>
            </div>
          </div>
        </CardContent>
      </TabCard>

      {/* Feedback Dialog */}
      <Dialog open={showFeedbackDialog} onOpenChange={setShowFeedbackDialog}>
          <DialogContent mobileMode="center" surface="soft" className="w-[min(94vw,28rem)] max-w-md p-4 sm:p-6">
            <DialogHeader className="mb-6">
            <DialogTitle>Share Your Feedback</DialogTitle>
            <DialogDescription>
              We&apos;d love to hear your thoughts on Pixotchi!
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label htmlFor={feedbackTextId} className="text-sm font-medium">
                Feedback
              </label>
              <p id={feedbackHelpId} className="text-xs text-muted-foreground">
                Share bugs, feature requests, or suggestions.
              </p>
            </div>
            <Textarea
              id={feedbackTextId}
              name="feedback"
              placeholder="What's on your mind? (e.g., bugs, feature requests, suggestions)"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              rows={5}
              className="min-h-32 w-full"
              spellCheck={true}
              autoComplete="off"
              aria-describedby={feedbackHelpId}
            />
            <Button
              type="button"
              onClick={submitFeedback}
              disabled={feedbackLoading || !address}
              aria-busy={feedbackLoading}
              className="w-full"
            >
              {feedbackLoading ? (
                <>
                  <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                  Sending...
                </>
              ) : (
                <>
                  <MessageCircle className="w-4 h-4 mr-2" />
                  Send Feedback
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="space-y-4 lg:flex lg:h-full lg:flex-col lg:justify-between lg:gap-5 lg:space-y-0 lg:rounded-[var(--radius-panel)] lg:border lg:border-[hsl(var(--border-strong)/0.4)] lg:bg-card lg:bg-[image:var(--gradient-surface-strong)] lg:p-5 lg:[box-shadow:var(--surface-highlight),var(--shadow-raised)] lg:backdrop-blur-md">
        {/* Community first, version last: `order` only applies in flex/grid, so the
            previous DOM order left the version stranded above the heading on mobile. */}
        <div className="text-center lg:flex lg:flex-1 lg:flex-col lg:justify-center">
          <h3 className="mb-3 text-sm font-semibold">Join our Community</h3>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={() => openExternalUrl('https://x.com/pixotchi')}
              aria-label="Open Pixotchi on X"
              className="surface-control inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] border text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
            >
              <XBrandIcon className="h-5 w-5" />
              <span className="sr-only">X (Twitter)</span>
            </button>
            <button
              type="button"
              onClick={() => openExternalUrl('https://t.me/pixotchi')}
              aria-label="Open Pixotchi on Telegram"
              className="surface-control inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] border text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
            >
              <TelegramBrandIcon className="h-6 w-6" />
              <span className="sr-only">Telegram</span>
            </button>
            <button
              type="button"
              onClick={() => openExternalUrl('https://farcaster.xyz/pixotchi.eth')}
              aria-label="Open Pixotchi on Farcaster"
              className="surface-control inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] border text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
            >
              <FarcasterBrandIcon className="h-6 w-6" />
              <span className="sr-only">Farcaster</span>
            </button>
          </div>
          {/* Caption so the collapsed Base mark reads as a logo rather than a stray square. */}
          <div className="mt-6 flex flex-col items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Built on Base
            </span>
            <BaseAnimatedLogo className="w-full" />
          </div>
        </div>

        {/* Version Number */}
        <div className="border-t border-border/55 pt-4 text-center lg:pt-4">
          <span className="text-xs text-muted-foreground font-mono">
            v{packageJson.version}
          </span>
        </div>
      </div>
      </div>
    </div>
  );
}
