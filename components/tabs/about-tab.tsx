"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, Book, Gamepad2, Tractor, Gift, Copy, Check, Users, Calendar, Plus, Info, Flame, Shield, MessageCircle, Swords, Box, MessageSquare } from "lucide-react";
import Image from "next/image";
import { useState, useEffect } from "react";
import { openExternalUrl } from "@/lib/open-external";
import { useMiniKit } from "@coinbase/onchainkit/minikit";
import { toast } from 'react-hot-toast';
import { formatInviteUrl, INVITE_CONFIG } from '@/lib/invite-utils';
import { InviteStats } from '@/lib/types';
import { useAccount } from 'wagmi';
import { BaseAnimatedLogo } from "@/components/ui/loading";
import { useSlideshow } from "@/components/tutorial";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import packageJson from '@/package.json';
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { useFrameContext } from "@/lib/frame-context";
import { EthModeToggle } from "@/components/eth-mode-toggle";

const InfoCard = ({
  icon,
  iconSrc,
  title,
  description,
  link,
  linkLabel,
}: {
  icon?: React.ElementType;
  iconSrc?: string;
  title: string;
  description: string;
  link: string;
  linkLabel: string;
}) => {
  const Icon = icon;

  const handleExternalLink = () => { openExternalUrl(link); };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10">
            {Icon && (
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <Icon className="w-6 h-6 text-primary" />
              </div>
            )}
            {iconSrc && (
              <Image
                src={iconSrc}
                alt={title}
                width={40}
                height={40}
                className="w-10 h-10 rounded-xl object-cover"
              />
            )}
          </div>
          <CardTitle className="font-pixel">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-4">{description}</p>
        <Button variant="secondary" onClick={handleExternalLink}>
          {linkLabel}
          <ArrowUpRight className="w-4 h-4 ml-2" />
        </Button>
      </CardContent>
    </Card>
  );
};

export default function AboutTab() {
  const { address } = useAccount();
  const { start, enabled } = useSlideshow();
  const { walletType, isSmartWallet } = useSmartWallet();
  const frameData = useFrameContext();
  const [stats, setStats] = useState<InviteStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [recentCodes, setRecentCodes] = useState<Array<{
    code: string;
    isUsed: boolean;
    createdAt: number;
  }>>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  // Load invite stats and user codes when component mounts
  useEffect(() => {
    if (address && INVITE_CONFIG.SYSTEM_ENABLED) {
      loadInviteStats();
      loadUserCodes();
    }
  }, [address]);

  const loadInviteStats = async () => {
    if (!address) return;

    setLoading(true);
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
  };

  const loadUserCodes = async () => {
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
        const codes = data.codes.slice(0, 5).map((codeData: any) => ({
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
  };

  const generateInviteCode = async () => {
    if (!address) {
      toast.error('Wallet not connected. Please connect your wallet.');
      return;
    }

    setGenerating(true);
    try {
      const response = await fetch('/api/invite/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
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

  // Gamification: streak and mission status
  const [streak, setStreak] = useState<{ current: number; best: number } | null>(null);
  const [missionPts, setMissionPts] = useState<number | null>(null);
  const [missionDay, setMissionDay] = useState<any | null>(null);
  const [missionTotal, setMissionTotal] = useState<number>(0);
  const [showMissionsInfo, setShowMissionsInfo] = useState(false);

  // Allow StatusBar Tasks button to open this dialog
  useEffect(() => {
    const handler = () => setShowMissionsInfo(true);
    window.addEventListener('pixotchi:openTasks' as any, handler as EventListener);
    return () => window.removeEventListener('pixotchi:openTasks' as any, handler as EventListener);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (!address) return;
        const sRes = await fetch(`/api/gamification/streak?address=${address}`);
        if (sRes.ok) {
          const s = await sRes.json();
          setStreak({ current: s.streak.current, best: s.streak.best });
        }
        const mRes = await fetch(`/api/gamification/missions?address=${address}`);
        if (mRes.ok) {
          const m = await mRes.json();
          setMissionPts(m.day?.pts ?? 0);
          setMissionDay(m.day || null);
          setMissionTotal(typeof m.total === 'number' && Number.isFinite(m.total) ? m.total : 0);
        }
      } catch { }
    })();
  }, [address]);

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
      const fcContext = (frameData?.context as any) ?? null;

      // Extract farcaster details
      let farcasterDetails: any = null;
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
        toast.success('Thank you for your feedback! 🙏');
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
    <div className="space-y-8">

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
                    <div className="text-2xl font-bold text-blue-600">{stats.successfulInvites}</div>
                    <div className="text-xs text-muted-foreground">Friends</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">{stats.dailyRemaining}</div>
                    <div className="text-xs text-muted-foreground">Remaining</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">{stats.totalInvites}</div>
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
                      Generating...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-2" />
                      Generate Invite Code
                    </>
                  )}
                </Button>

                {stats && !stats.canGenerateToday && (
                  <p className="text-xs text-orange-600 mt-2">
                    Daily limit reached. Try again tomorrow!
                  </p>
                )}

                {!address && (
                  <p className="text-xs text-orange-600 mt-2">
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
                    {recentCodes.slice(0, 3).map((codeData) => (
                      <div
                        key={codeData.code}
                        className={`flex items-center justify-between p-2 bg-muted/50 rounded-lg ${codeData.isUsed ? 'opacity-60' : ''
                          }`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${codeData.isUsed ? 'bg-green-500' : 'bg-blue-500'
                            }`} />
                          <div className={`font-pixel text-sm font-medium ${codeData.isUsed ? 'line-through text-muted-foreground' : ''
                            }`}>
                            {codeData.code}
                          </div>
                          {codeData.isUsed && (
                            <span className="text-xs bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded-full">
                              Used
                            </span>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(codeData.code)}
                            className="h-7 w-7 p-0 hover:bg-background"
                            disabled={codeData.isUsed}
                          >
                            {copiedCode === codeData.code ? (
                              <Check className="w-3 h-3 text-green-600" />
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
                          onClick={() => {/* Could expand to show more */ }}
                          className="text-xs text-muted-foreground h-6"
                        >
                          +{recentCodes.length - 3} more codes
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

      {/* Daily Progress (Streak + Missions) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Farmer's Tasks</span>
            <Button variant="outline" size="sm" onClick={() => setShowMissionsInfo(true)}>
              <Info className="w-4 h-4 mr-2" /> How Tasks Work
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Streak */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Current Streak</p>
                <p className="text-2xl font-bold">{streak?.current ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">Best: {streak?.best ?? 0}</p>
              </div>
              <svg width="24" height="24" viewBox="0 0 24 24" className="w-6 h-6 animate-streak-colors" aria-hidden="true">
                <rect x="2" y="2" width="20" height="20" rx="3" />
              </svg>
            </div>
            <div className="p-3 rounded-lg bg-muted flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Today's Rock</p>
                <p className="text-2xl font-bold">{missionPts ?? 0} / 80</p>
                <p className="text-xs text-muted-foreground mt-1">Lifetime Rocks: {missionTotal}</p>
              </div>
              <Image src="/icons/Volcanic_Rock.svg" alt="Rock" width={24} height={24} className="w-6 h-6" />
            </div>
          </div>
          {/* Compact summary only; details in modal */}
        </CardContent>
      </Card>

      {/* Description */}
      <Card>
        <CardContent>
          <p className="text-muted-foreground mb-4">
            <span className="font-pixel text-foreground">PIXOTCHI</span> is a 1.5 year old tamagotchi-style onchain game on Base where you can mint, grow,
            and interact with your plants and lands; earning ETH rewards in the process. This App
            brings an enhanced experience using latest Base features, designed for Base app.
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                variant="secondary"
                onClick={() => openExternalUrl('https://doc.pixotchi.tech')}
                className="w-full"
              >
                <Book className="w-4 h-4 mr-2" />
                Documentation
              </Button>
              <Button
                variant="secondary"
                onClick={() => openExternalUrl('https://status.pixotchi.tech')}
                className="w-full"
              >
                Status
              </Button>
            </div>
            {enabled && (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => start({ reset: true })}>
                  Tutorial
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowFeedbackDialog(true)}
                >
                  Feedback
                </Button>
              </div>
            )}
            {!enabled && (
              <Button
                variant="outline"
                onClick={() => setShowFeedbackDialog(true)}
              >
                Feedback
              </Button>
            )}

            {/* ETH Mode Toggle - Only for Smart Wallet users */}
            <div className="pt-3 border-t border-border/30">
              <EthModeToggle />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Version Number */}
      <div className="text-center">
        <span className="text-xs text-muted-foreground/60 font-mono">
          v{packageJson.version}
        </span>
      </div>

      {/* Missions Info Dialog */}
      <Dialog open={showMissionsInfo} onOpenChange={setShowMissionsInfo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>How Tasks Work</DialogTitle>
            <DialogDescription>
              Earn up to 80 Rock per day by completing 4 sections:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <div className="font-medium">Section 1 (20 Rock)</div>
              <ul className="list-disc pl-5 text-muted-foreground">
                <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s1?.buy5 ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Buy at least 5 elements</li>
                <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s1?.buyShield ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Buy a shield/fence</li>
                <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s1?.claimProduction ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Claim production from any building</li>
              </ul>
            </div>
            <div>
              <div className="font-medium">Section 2 (20 Rock)</div>
              <ul className="list-disc pl-5 text-muted-foreground">
                <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s2?.applyResources ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Apply resources/production to a plant</li>
                <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s2?.attackPlant ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Attack another plant</li>
                <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s2?.chatMessage ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Send a message in public chat</li>
              </ul>
            </div>
            <div>
              <div className="font-medium">Section 3 (10 Rock)</div>
              <ul className="list-disc pl-5 text-muted-foreground">
                <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s3?.sendQuest ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Send a farmer on a quest</li>
                <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s3?.placeOrder ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Place a SEED/LEAF order</li>
                <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s3?.claimStake ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Claim stake rewards</li>
              </ul>
            </div>
            <div>
              <div className="font-medium">Section 4 (30 Rock)</div>
              <ul className="list-disc pl-5 text-muted-foreground">
                <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s4?.makeSwap ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Make a SEED swap</li>
                <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s4?.collectStar ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Collect a star by killing a plant</li>
                <li className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${missionDay?.s4?.playArcade ? 'bg-green-500' : 'bg-muted-foreground/40'}`}></span> Play an arcade game (Box or Spin)</li>
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Feedback Dialog */}
      <Dialog open={showFeedbackDialog} onOpenChange={setShowFeedbackDialog}>
        <DialogContent>
          <DialogHeader className="mb-6">
            <DialogTitle>Share Your Feedback</DialogTitle>
            <DialogDescription>
              We'd love to hear your thoughts on Pixotchi Mini!
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder="What's on your mind? (e.g., bugs, feature requests, suggestions)"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              rows={5}
              className="w-full"
            />
            <Button onClick={submitFeedback} disabled={feedbackLoading || !address}>
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

      <div className="pt-6 text-center">
        <h3 className="text-lg font-semibold mb-3">Join our Community</h3>
        <div className="flex justify-center space-x-4">
          <button
            onClick={() => openExternalUrl('https://x.com/pixotchi')}
            className="text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background rounded-md p-1"
          >
            <Image src="/icons/twitter.png" alt="X" width={24} height={24} />
            <span className="sr-only">X (Twitter)</span>
          </button>
          <button
            onClick={() => openExternalUrl('https://t.me/pixotchi')}
            className="text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background rounded-md p-1"
          >
            <Image src="/icons/Telegram.png" alt="Telegram" width={24} height={24} />
            <span className="sr-only">Telegram</span>
          </button>
        </div>
      </div>

      <div className="pt-6">
        <BaseAnimatedLogo className="mx-auto w-full" />
      </div>
    </div>
  );
}

