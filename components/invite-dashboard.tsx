"use client";

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import {
  Gift,
  Copy,
  Check,
  Users,
  TrendingUp,
  Calendar,
  Share2,
  Plus,
  Info
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { formatInviteUrl } from '@/lib/invite-utils';
import { InviteStats } from '@/lib/types';

interface InviteDashboardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function InviteDashboard({ open, onOpenChange }: InviteDashboardProps) {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [stats, setStats] = useState<InviteStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [recentCodes, setRecentCodes] = useState<string[]>([]);
  const [systemEnabled, setSystemEnabled] = useState(true);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // React Query: invite stats
  const inviteStatsQuery = useQuery({
    queryKey: ['invite-stats', address],
    enabled: !!address && open,
    queryFn: async () => {
      const res = await fetch('/api/invite/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      return data;
    }
  });

  useEffect(() => {
    if (inviteStatsQuery.data?.systemEnabled) {
      setStats(inviteStatsQuery.data.stats);
      setSystemEnabled(true);
    } else if (inviteStatsQuery.data) {
      setSystemEnabled(false);
    }
  }, [inviteStatsQuery.data]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/invite/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      return response.json();
    },
    onSuccess: async (data: any) => {
      if (data.success) {
        const newCode = data.code;
        setRecentCodes(prev => [newCode, ...prev.slice(0, 4)]);
        // Use invalidateQueries instead of direct refetch for proper cache management
        await queryClient.invalidateQueries({ queryKey: ['invite-stats', address] });
        toast.success('New invite code generated!');
        await copyToClipboard(newCode, 'New invite code');
      } else {
        toast.error(data.error || 'Failed to generate invite code');
      }
    },
    onError: () => toast.error('Failed to generate invite code'),
    onSettled: () => setGenerating(false),
  });

  const generateInviteCode = async () => {
    if (!address) return;
    setGenerating(true);
    await generateMutation.mutateAsync();
  };

  const copyToClipboard = async (code: string, label: string = 'Invite code') => {
    try {
      const url = formatInviteUrl(code);
      await navigator.clipboard.writeText(url);
      setCopiedCode(code);
      toast.success(`${label} copied to clipboard!`);

      // Reset copied state after 2 seconds
      setTimeout(() => setCopiedCode(null), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      toast.error('Failed to copy to clipboard');
    }
  };

  const shareInviteCode = async (code: string) => {
    const url = formatInviteUrl(code);
    const shareData = {
      title: 'Join me on Pixotchi Mini!',
      text: 'I\'m growing onchain plants on Pixotchi Mini. Use my invite code to join:',
      url: url,
    };

    try {
      if (navigator.share && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        // Fallback to clipboard
        await copyToClipboard(code, 'Invite link');
      }
    } catch (error) {
      console.error('Error sharing:', error);
      await copyToClipboard(code, 'Invite link');
    }
  };

  if (!systemEnabled) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="w-5 h-5" />
              Invite System
            </DialogTitle>
            <DialogDescription>
              The invite system is currently disabled.
            </DialogDescription>
          </DialogHeader>
          <div className="text-center space-y-4 py-6">
            <div className="w-16 h-16 mx-auto bg-muted rounded-full flex items-center justify-center">
              <Info className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold">Invite System Disabled</h3>
              <p className="text-sm text-muted-foreground mt-1">
                The invite system is currently disabled.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold flex items-center gap-2">
            <Gift className="w-5 h-5" />
            Invite Friends
          </DialogTitle>
          <DialogDescription>
            Generate invite codes and track your referral statistics.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Stats Cards */}
          {stats && (
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="flex items-center justify-center w-10 h-10 bg-blue-100 rounded-full mx-auto mb-2">
                    <Users className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="text-2xl font-bold">{stats.successfulInvites}</div>
                  <div className="text-xs text-muted-foreground">Friends Invited</div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 text-center">
                  <div className="flex items-center justify-center w-10 h-10 bg-green-100 rounded-full mx-auto mb-2">
                    <Calendar className="w-5 h-5 text-green-600" />
                  </div>
                  <div className="text-2xl font-bold">{stats.dailyRemaining}</div>
                  <div className="text-xs text-muted-foreground">Remaining Today</div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Generate New Code */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Generate Invite Code</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Share Pixotchi Mini with your friends! You can generate up to 2 invite codes per day.
              </p>

              <Button
                onClick={generateInviteCode}
                disabled={generating || !stats?.canGenerateToday || loading}
                className="w-full"
              >
                {generating ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    Generate New Code
                  </>
                )}
              </Button>

              {stats && !stats.canGenerateToday && (
                <p className="text-xs text-orange-600 text-center">
                  Daily limit reached. Try again tomorrow!
                </p>
              )}
            </CardContent>
          </Card>

          {/* Recent Codes */}
          {recentCodes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Codes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {recentCodes.map((code, index) => (
                    <div
                      key={code}
                      className="flex items-center justify-between p-3 bg-muted rounded-md"
                    >
                      <div className="font-mono text-sm">{code}</div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(code)}
                          className="h-8 w-8 p-0"
                        >
                          {copiedCode === code ? (
                            <Check className="w-3 h-3 text-green-600" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => shareInviteCode(code)}
                          className="h-8 w-8 p-0"
                        >
                          <Share2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Help */}
          <Card className="bg-primary/10 border-primary/20">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <div className="font-medium text-foreground mb-1">
                    How it works:
                  </div>
                  <ul className="text-muted-foreground space-y-1 text-xs">
                    <li>• Generate up to 2 invite codes daily</li>
                    <li>• Each code can only be used once</li>
                    <li>• Codes expire after 7 days</li>
                    <li>• Share the full link with friends</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
} 