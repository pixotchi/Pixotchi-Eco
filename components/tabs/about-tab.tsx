"use client";

import { useSlideshow } from "@/components/tutorial";
import { Button } from "@/components/ui/button";
import { Card,CardContent } from "@/components/ui/card";
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { BaseAnimatedLogo } from "@/components/ui/loading";
import { Textarea } from "@/components/ui/textarea";
import { getMiniAppQuickAuthHeaders } from "@/lib/farcaster-miniapp-auth-client";
import { useFrameContext } from "@/lib/frame-context";
import { INVITE_CONFIG } from '@/lib/invite-utils';
import { openExternalUrl } from "@/lib/open-external";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { useTabVisibility } from "@/lib/tab-visibility-context";
import { InviteStats } from '@/lib/types';
import packageJson from '@/package.json';
import { Book,Calendar,Check,Copy,ExternalLink,Gift,MessageCircle,PlayCircle,Plus,Radio } from "lucide-react";
import Image from "next/image";
import { useCallback,useEffect,useId,useRef,useState } from "react";
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

const ABOUT_SCENE_SPRITES = [
  { src: "/icons/plantGrowth.gif", alt: "", width: 190, height: 190, className: "left-[6%] top-[4%] w-[30%]", animation: "about-scene-bob 6s ease-in-out infinite" },
  { src: "/icons/plantGrowth4.gif", alt: "", width: 260, height: 260, className: "left-[36%] top-[26%] w-[41%]", animation: "about-scene-bob 7s ease-in-out infinite -1s" },
  { src: "/icons/plantGrowth2.gif", alt: "", width: 150, height: 150, className: "right-[8%] top-[10%] w-[24%]", animation: "about-scene-bob 5s ease-in-out infinite -2s" },
  { src: "/icons/plantGrowth5.gif", alt: "", width: 130, height: 130, className: "bottom-[10%] left-[16%] w-[20%]", animation: "about-scene-bob 8s ease-in-out infinite -3s" },
  { src: "/icons/plantGrowth6.gif", alt: "", width: 170, height: 170, className: "bottom-[4%] right-[8%] w-[27%]", animation: "about-scene-bob 6.5s ease-in-out infinite -0.5s" },
  { src: "/icons/farmer-house.svg", alt: "", width: 110, height: 110, className: "left-[28%] top-[18%] w-[17%]", animation: "about-scene-bob 7.5s ease-in-out infinite -1.5s" },
  { src: "/icons/bee-house.svg", alt: "", width: 140, height: 140, className: "left-[4%] top-[50%] w-[22%]", animation: "about-scene-bob 6.2s ease-in-out infinite -2.4s" },
  { src: "/icons/stake-house.svg", alt: "", width: 120, height: 120, className: "right-[4%] top-[44%] w-[19%]", animation: "about-scene-bob 7.8s ease-in-out infinite -0.8s" },
  { src: "/icons/soil-factory.svg", alt: "", width: 100, height: 100, className: "bottom-[20%] left-[44%] w-[16%]", animation: "about-scene-bob 5.6s ease-in-out infinite -3.2s" },
  { src: "/icons/solar-panels.svg", alt: "", width: 96, height: 96, className: "left-[48%] top-[2%] w-[15%]", animation: "about-scene-bob 6.8s ease-in-out infinite -1.1s" },
] as const;

const AboutWorldScene = () => (
  <div className="hidden lg:flex lg:min-h-[390px] lg:items-center lg:justify-center" aria-hidden="true">
    <div className="relative aspect-square w-full max-w-[440px]">
      {ABOUT_SCENE_SPRITES.map((sprite) => (
        <Image
          key={sprite.src}
          src={sprite.src}
          alt={sprite.alt}
          width={sprite.width}
          height={sprite.height}
          className={`absolute h-auto select-none object-contain [image-rendering:pixelated] drop-shadow-[0_14px_22px_rgba(15,23,42,0.18)] ${sprite.className}`}
          style={{ animation: sprite.animation }}
          loading="eager"
          fetchPriority={
            sprite.src === "/icons/plantGrowth4.gif" || sprite.src === "/icons/plantGrowth.gif"
              ? "high"
              : "auto"
          }
          unoptimized={sprite.src.endsWith(".gif")}
        />
      ))}
    </div>
  </div>
);

export default function AboutTab() {
  const feedbackTextId = useId();
  const feedbackHelpId = useId();
  const { address } = useAccount();
  const { start, enabled } = useSlideshow();
  const { walletType, isSmartWallet } = useSmartWallet();
  const frameData = useFrameContext();
  const { isTabVisible } = useTabVisibility();
  const isVisible = isTabVisible('about');
  const [stats, setStats] = useState<InviteStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [recentCodes, setRecentCodes] = useState<Array<{
    code: string;
    isUsed: boolean;
    createdAt: number;
  }>>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [showAllRecentCodes, setShowAllRecentCodes] = useState(false);
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const statsRef = useRef<InviteStats | null>(null);

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  const loadInviteStats = useCallback(async () => {
    if (!address) return;

    // Only show loading state if we have no stats yet
    if (!statsRef.current) {
      setLoading(true);
    }
    try {
      const response = await fetch('/api/invite/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });

      const data = await response.json();

      if (data.systemEnabled) {
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Error loading invite stats:', error);
      toast.error('Failed to load invite statistics');
    } finally {
      setLoading(false);
    }
  }, [address]);

  const loadUserCodes = useCallback(async () => {
    if (!address) return;

    try {
      const response = await fetch('/api/invite/user-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });

      const data = await response.json();

      if (data.success) {
        // Get the most recent 5 codes with their status
        const codes = data.codes.slice(0, 5).map((codeData: UntypedValue) => ({
          code: codeData.code,
          isUsed: codeData.isUsed,
          createdAt: codeData.createdAt,
        }));
        setRecentCodes(codes);
      }
    } catch (error) {
      console.error('Error loading user codes:', error);
      // Don't show error to user as this is not critical
    }
  }, [address]);

  // Load invite stats and user codes when component mounts
  useEffect(() => {
    if (address && INVITE_CONFIG.SYSTEM_ENABLED) {
      loadInviteStats();
      loadUserCodes();
    }
  }, [address, loadInviteStats, loadUserCodes]);

  // Refresh when tab becomes visible
  useEffect(() => {
    if (isVisible && address && INVITE_CONFIG.SYSTEM_ENABLED) {
      loadInviteStats();
      loadUserCodes();
    }
  }, [isVisible, address, loadInviteStats, loadUserCodes]);

  const generateInviteCode = async () => {
    if (!address) {
      toast.error('Wallet not connected. Please connect your wallet.');
      return;
    }

    setGenerating(true);
    try {
      const authHeaders = await getMiniAppQuickAuthHeaders();
      const response = await fetch('/api/invite/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
      });

      const data = await response.json();

      if (data.success) {
        const newCode = data.code;

        toast.success('New invite code generated!');

        // Auto-copy to clipboard
        await copyToClipboard(newCode, 'New invite code');

        // Reload both stats and codes to ensure everything is up to date
        await Promise.all([
          loadInviteStats(),
          loadUserCodes(),
        ]);
      } else {
        toast.error(data.error || 'Failed to generate invite code');
      }
    } catch (error) {
      console.error('Error generating invite code:', error);
      toast.error('Failed to generate invite code');
    } finally {
      setGenerating(false);
    }
  };

  // Note: Gamification streak/missions now handled by TasksInfoDialog component

  const copyToClipboard = async (code: string, label: string = 'Invite code') => {
    try {
      // Copy just the code, not the full URL
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      toast.success(`${label} copied to clipboard!`);

      // Reset copied state after 2 seconds
      setTimeout(() => setCopiedCode(null), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      toast.error('Failed to copy to clipboard');
    }
  };

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
    <div className="mx-auto max-w-[36rem] space-y-8 lg:max-w-5xl">

      {/* Invite Section - Only show if system is enabled */}
      {INVITE_CONFIG.SYSTEM_ENABLED && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Gift className="w-5 h-5" />
            Invite Friends
          </h2>

          {/* Compact Stats & Generate Section */}
          <Card>
            <CardContent className="p-4">
              {stats && (
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-[hsl(var(--info))]">{stats.successfulInvites}</div>
                    <div className="text-xs text-muted-foreground">Friends</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-[hsl(var(--success-strong))]">{stats.dailyRemaining}</div>
                    <div className="text-xs text-muted-foreground">Remaining</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-violet-700 dark:text-violet-200">{stats.totalInvites}</div>
                    <div className="text-xs text-muted-foreground">Generated</div>
                  </div>
                </div>
              )}

              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-3">
                  Share Pixotchi Mini! Generate up to 2 codes daily.
                </p>

                <Button
                  onClick={generateInviteCode}
                  disabled={generating || !stats?.canGenerateToday || loading || !address}
                  className="w-full max-w-xs"
                  size="lg"
                >
                  {generating ? (
                    <>
                      <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-2" />
                      Generate Invite Code
                    </>
                  )}
                </Button>

                {stats && !stats.canGenerateToday && (
                  <p className="text-xs text-[hsl(var(--warning))] mt-2">
                    Daily limit reached. Try again tomorrow!
                  </p>
                )}

                {!address && (
                  <p className="text-xs text-[hsl(var(--warning))] mt-2">
                    Connect your wallet to generate codes
                  </p>
                )}
              </div>

              {/* Recent Codes - Integrated Section */}
              {recentCodes.length > 0 && (
                <div className="mt-6 pt-4 border-t">
                  <div className="flex items-center gap-2 mb-3">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <h3 className="text-sm font-medium">Your Recent Codes</h3>
                  </div>
                  <div className="space-y-2">
                    {(showAllRecentCodes ? recentCodes : recentCodes.slice(0, 3)).map((codeData) => (
                      <div
                        key={codeData.code}
                        className={`flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border/60 bg-muted/50 p-2.5 ${codeData.isUsed ? 'opacity-60' : ''
                          }`}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${codeData.isUsed ? 'bg-[hsl(var(--success))]' : 'bg-[hsl(var(--info))]'
                            }`} />
                          <div className={`min-w-0 truncate font-mono text-sm font-semibold ${codeData.isUsed ? 'line-through text-muted-foreground' : ''
                            }`}>
                            {codeData.code}
                          </div>
                          {codeData.isUsed && (
                            <span className="text-xs bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success-strong))] px-1.5 py-0.5 rounded-full">
                              Used
                            </span>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => copyToClipboard(codeData.code)}
                            className="shrink-0 hover:bg-background"
                            disabled={codeData.isUsed}
                            aria-label={`Copy invite code ${codeData.code}`}
                          >
                            {copiedCode === codeData.code ? (
                              <Check className="w-3 h-3 text-[hsl(var(--success-strong))]" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}

                    {recentCodes.length > 3 && (
                      <div className="text-center pt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowAllRecentCodes((prev) => !prev)}
                          className="text-xs text-muted-foreground h-6"
                        >
                          {showAllRecentCodes
                            ? 'Show less'
                            : `+${recentCodes.length - 3} more codes`}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="space-y-8 lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-stretch lg:gap-5 lg:space-y-0">
      {/* Description */}
      <Card className="lg:h-fit">
        <CardContent>
          <p className="text-muted-foreground mb-4">
            <span className="font-pixel text-foreground">PIXOTCHI</span> is a tamagotchi-style onchain game on Base where you mint, grow, and care for plants and lands while earning real ETH rewards. Keep your plants alive, increase their score, and compete on the global leaderboard.
          </p>
          <p className="text-muted-foreground mb-4">
            Every player follows a different strategy. Some invest in Lands for long-term, passive growth, while others push their plants aggressively using the marketplace to climb rankings faster at a higher cost.
          </p>

          <div className="space-y-3 lg:flex lg:flex-wrap lg:gap-2 lg:space-y-0">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:contents">
              <Button
                variant="secondary"
                onClick={() => openExternalUrl('https://doc.pixotchi.tech')}
                className="w-full lg:w-auto"
              >
                <Book className="w-4 h-4 mr-2" />
                Documentation
                <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                variant="secondary"
                onClick={() => openExternalUrl('https://status.pixotchi.tech')}
                className="w-full lg:w-auto"
                aria-label="Open Pixotchi status"
              >
                <Radio className="w-4 h-4 mr-2" />
                Status
              </Button>
            </div>
            {enabled && (
              <div className="grid grid-cols-2 gap-2 lg:contents">
                <Button
                  onClick={() => start({ reset: true })}
                  className="bg-value bg-[image:var(--gradient-value)] text-white hover:brightness-[1.03] lg:w-auto"
                  aria-label="Start Pixotchi tutorial"
                >
                  <PlayCircle className="w-4 h-4 mr-2" />
                  Tutorial
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowFeedbackDialog(true)}
                  className="lg:w-auto"
                  aria-label="Open feedback dialog"
                >
                  <MessageCircle className="w-4 h-4 mr-2" />
                  Feedback
                </Button>
              </div>
            )}
            {!enabled && (
              <Button
                variant="outline"
                onClick={() => setShowFeedbackDialog(true)}
                className="lg:w-auto"
                aria-label="Open feedback dialog"
              >
                <MessageCircle className="w-4 h-4 mr-2" />
                Feedback
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Feedback Dialog */}
      <Dialog open={showFeedbackDialog} onOpenChange={setShowFeedbackDialog}>
          <DialogContent mobileMode="sheet" surface="soft" className="p-4 sm:p-6">
            <DialogHeader className="mb-6">
            <DialogTitle>Share Your Feedback</DialogTitle>
            <DialogDescription>
              We&apos;d love to hear your thoughts on Pixotchi Mini!
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
                  Sending…
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

      <div className="space-y-4 lg:flex lg:h-full lg:flex-col lg:justify-between lg:gap-4 lg:space-y-0 lg:rounded-[var(--radius-panel)] lg:border lg:border-border/60 lg:bg-card/90 lg:bg-[image:var(--gradient-surface)] lg:p-4 lg:shadow-[var(--shadow-hairline)]">
        {/* Version Number */}
        <div className="text-center lg:order-2 lg:border-t lg:border-border/60 lg:pt-4">
          <span className="text-xs text-muted-foreground/60 font-mono">
            v{packageJson.version}
          </span>
        </div>

        <div className="text-center lg:order-1 lg:flex lg:flex-1 lg:flex-col lg:justify-center">
          <h3 className="text-sm font-semibold mb-2">Join our Community</h3>
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
          <BaseAnimatedLogo className="mx-auto mt-4 w-full" />
        </div>
      </div>
      </div>
      <AboutWorldScene />
    </div>
  );
}
