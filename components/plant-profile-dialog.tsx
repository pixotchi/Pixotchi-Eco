"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Copy,
  ExternalLink,
  Globe as GlobeIcon,
  Mail as MailIcon,
  Heart,
  Repeat2,
  MessageCircle,
  Bookmark,
  Quote,
  ImageIcon,
} from 'lucide-react';
import Image from 'next/image';
import PlantImage from '@/components/PlantImage';
import { getUserGameStats } from '@/lib/user-stats-service';
import { getStakeInfo } from '@/lib/contracts';
import { formatEthShort, formatTokenAmount, formatAddress } from '@/lib/utils';
import { openExternalUrl } from '@/lib/open-external';
import { usePrimaryName } from '@/components/hooks/usePrimaryName';
import { useWalletSocialProfile } from '@/hooks/useWalletSocialProfile';
import toast from 'react-hot-toast';
import type { Plant } from '@/lib/types';
import { fetchEfpStats, type EthFollowStats } from '@/lib/efp-service';
import { useAccount } from 'wagmi';
import { FollowButton, useTransactions, type FollowingState } from 'ethereum-identity-kit';
import { Avatar } from '@coinbase/onchainkit/identity';
import { base } from 'viem/chains';
import { formatDistanceToNow } from 'date-fns';
import { useQuery } from '@tanstack/react-query';

type TwitterMediaLite = { type?: string | null; url?: string | null };
type TwitterPostLite = {
  id: string;
  text: string;
  createdAt?: string | null;
  url?: string | null;
  metrics?: {
    likes?: number;
    reposts?: number;
    quotes?: number;
    replies?: number;
    bookmarks?: number;
  };
  media?: (TwitterMediaLite | null | undefined)[] | null;
};
type TwitterDataLite = {
  username?: string;
  status?: string;
  fetchedAt?: number | null;
  posts?: TwitterPostLite[];
};

interface PlantProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plant: (Plant & { rank?: number }) | null;
  variant?: 'plant' | 'wallet';
  walletAddressOverride?: string | null;
  walletNameOverride?: string | null;
  primaryPlantLoading?: boolean;
}

interface OwnerStats {
  totalPlants: number;
  totalLands: number;
  stakedSeed: bigint;
}

const CACHE_DURATION = 120000; // 2 minutes

const formatStaked = (amount: bigint) => formatTokenAmount(amount, 18);

function formatCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

function formatIdentityValue(platform: string, value: string): string {
  if (platform.toLowerCase() === 'ethereum' && value.startsWith('0x')) {
    return formatAddress(value, 4, 4, false);
  }
  if (value.length > 28) {
    return `${value.slice(0, 24)}…`;
  }
  return value;
}

const platformIconSource: Record<string, string> = {
  twitter: '/icons/x.png',
  github: '/icons/github.png',
  farcaster: '/icons/farcaster.png',
  zora: '/icons/zora.png',
  'talent-protocol': '/icons/talent.png',
};

const platformFallbackIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  website: GlobeIcon,
  ens: GlobeIcon,
  email: MailIcon,
  zora: GlobeIcon,
  'talent-protocol': GlobeIcon,
};

const getPlatformIcon = (platform: string) => {
  const key = platform.toLowerCase();
  const asset = platformIconSource[key];
  const Fallback = platformFallbackIcon[key] ?? GlobeIcon;
  return asset
    ? ({ className }: { className?: string }) => (
        <Image src={asset} alt={platform} width={16} height={16} className={className ?? ''} />
      )
    : Fallback;
};

const getIdentityUrl = (platform: string, value: string, existingUrl?: string | null) => {
  if (existingUrl) return existingUrl;
  const lower = platform.toLowerCase();
  if (lower === 'ethereum' && value.startsWith('0x')) {
    return `https://base.blockscout.com/address/${value}`;
  }
  if (lower === 'solana') {
    return `https://solscan.io/account/${value}`;
  }
  return null;
};

export default function PlantProfileDialog({
  open,
  onOpenChange,
  plant,
  variant = 'plant',
  walletAddressOverride = null,
  walletNameOverride = null,
  primaryPlantLoading = false,
}: PlantProfileDialogProps) {
  const [otherDialogOpen, setOtherDialogOpen] = useState(false);
  const [postsDialogOpen, setPostsDialogOpen] = useState(false);
  const [efpRefreshKey, setEfpRefreshKey] = useState(0);

  // Get connected wallet address
  const { address: connectedAddress } = useAccount();
  const isWalletVariant = variant === 'wallet';
  const ownerAddress = useMemo<string | null>(() => {
    if (plant?.owner) return plant.owner;
    return walletAddressOverride ?? null;
  }, [plant?.owner, walletAddressOverride]);
  const plantId = plant?.id ?? null;
  
  // Get TransactionModal state to detect when it's open/closed
  const { txModalOpen } = useTransactions();
  
  // Close plant profile dialog when TransactionModal opens
  useEffect(() => {
    if (txModalOpen && open) {
      onOpenChange(false);
    }
  }, [txModalOpen, open, onOpenChange]);

  // Resolve ENS/Basename using shared resolver
  const { name: ownerNameDerived, loading: isNameLoading } = usePrimaryName(ownerAddress);
  const ownerName = walletNameOverride ?? ownerNameDerived ?? null;
  const socialIdentifier = ownerName || ownerAddress || null;
  const {
    data: socialProfile,
    loading: socialProfileLoading,
    error: socialProfileError,
    cached: socialCached,
  } = useWalletSocialProfile(ownerAddress, {
    enabled: open && Boolean(ownerAddress),
    identifier: socialIdentifier,
  });
  const identitySummary = socialProfile?.identitySummary;
  const twitterHandle = useMemo(() => {
    return identitySummary?.handles?.find(
      (handle) => handle.platform?.toLowerCase?.() === 'twitter' && handle.value
    ) ?? null;
  }, [identitySummary]);
  const twitterData = (socialProfile as { twitter?: TwitterDataLite } | null)?.twitter ?? null;
  const twitterUsername = twitterData?.username ?? twitterHandle?.value ?? null;
  const twitterPosts: TwitterPostLite[] = twitterData?.posts ?? [];
  const twitterStatus = twitterData?.status ?? null;
  const twitterLastUpdated = useMemo(() => {
    if (!twitterData?.fetchedAt) return null;
    const date = new Date(twitterData.fetchedAt);
    if (Number.isNaN(date.getTime())) return null;
    try {
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return date.toLocaleString();
    }
  }, [twitterData?.fetchedAt]);
  const canShowPostsButton = Boolean(socialProfile?.memoryProfile && twitterUsername);
  const formatTwitterPostAge = useCallback((value?: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    try {
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return date.toLocaleString();
    }
  }, []);
  const twitterStatusLabel = useMemo(() => {
    if (!twitterStatus) return null;
    return twitterStatus.replace(/_/g, ' ');
  }, [twitterStatus]);
  const primaryIdentities = useMemo(() => {
    if (!identitySummary?.handles) return [];
    const handles = identitySummary.handles;
    const priority = ['farcaster', 'twitter', 'github', 'zora', 'talent-protocol', 'email', 'ens', 'website'];
    const seen = new Set<string>();
    const selections: typeof handles = [];
    const pushHandle = (handle: (typeof handles)[number]) => {
      const key = `${handle.platform}:${handle.value}`;
      if (seen.has(key)) return;
      seen.add(key);
      selections.push(handle);
    };
    for (const platform of priority) {
      const found = handles.find((handle) => handle.platform?.toLowerCase?.() === platform);
      if (found) pushHandle(found);
      if (selections.length >= 5) break;
    }
    if (selections.length < 5) {
      handles.forEach((handle) => {
        if (selections.length >= 5) return;
        pushHandle(handle);
      });
    }
    return selections.slice(0, 5);
  }, [identitySummary]);
  const primaryIdentity = primaryIdentities[0] ?? null;
  
  const socialIconHandles = useMemo(() => {
    const handles = identitySummary?.handles ?? [];
    const order = ['farcaster', 'twitter', 'github', 'zora', 'talent-protocol', 'email', 'website'];
    const result: typeof handles = [];
    const primaryKey = primaryIdentity ? `${primaryIdentity.platform}:${primaryIdentity.value}` : null;
    for (const platform of order) {
      const found = handles.find((handle) => handle.platform?.toLowerCase?.() === platform);
      if (found) {
        const key = `${found.platform}:${found.value}`;
        if (key !== primaryKey) {
          result.push(found);
        }
      }
    }
    return result;
  }, [identitySummary, primaryIdentity]);

  const combinedSocialHandles = useMemo(() => {
    const walletPlatforms = new Set(['ethereum', 'solana', 'basenames']);
    const combined: typeof socialIconHandles = [];
    if (primaryIdentity) {
      const platform = primaryIdentity.platform?.toLowerCase?.() || '';
      if (!walletPlatforms.has(platform)) {
        combined.push(primaryIdentity);
      }
    }
    const priority = ['farcaster', 'twitter', 'github', 'zora', 'talent-protocol', 'email', 'website'];
    priority.forEach((platform) => {
      const candidate = socialIconHandles.find((handle) => handle.platform?.toLowerCase?.() === platform);
      if (candidate) {
        const key = `${candidate.platform}:${candidate.value}`;
        if (!combined.some((existing) => `${existing.platform}:${existing.value}` === key)) {
          combined.push(candidate);
        }
      }
    });
    socialIconHandles.forEach((handle) => {
      const key = `${handle.platform}:${handle.value}`;
      if (!combined.some((existing) => `${existing.platform}:${existing.value}` === key)) {
        combined.push(handle);
      }
    });
    const filtered = combined.filter((handle) => {
      const platform = handle.platform?.toLowerCase?.() || '';
      return !walletPlatforms.has(platform);
    });
    return filtered.slice(0, 20);
  }, [primaryIdentity, socialIconHandles]);

  const otherWallets = useMemo(() => {
    const handles = identitySummary?.handles ?? [];
    const primaryKey = primaryIdentity ? `${primaryIdentity.platform}:${primaryIdentity.value}` : null;
    const wallets = handles.filter((handle) => {
      const platform = handle.platform?.toLowerCase?.() || '';
      const isWallet = platform === 'ethereum' || platform === 'solana';
      if (!isWallet) return false;
      const key = `${handle.platform}:${handle.value}`;
      return key !== primaryKey;
    });
    const unique: typeof wallets = [];
    const seen = new Set<string>();
    wallets.forEach((handle) => {
      const key = `${handle.platform}:${handle.value}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(handle);
      }
    });
    return unique.slice(0, 6);
  }, [identitySummary, primaryIdentity]);

  const otherBasenames = useMemo(() => {
    const handles = identitySummary?.handles ?? [];
    const primaryKey = primaryIdentity ? `${primaryIdentity.platform}:${primaryIdentity.value}` : null;
    const names = handles.filter((handle) => {
      const platform = handle.platform?.toLowerCase?.() || '';
      if (platform !== 'basenames') return false;
      const key = `${handle.platform}:${handle.value}`;
      return key !== primaryKey;
    });
    const unique: typeof names = [];
    const seen = new Set<string>();
    names.forEach((handle) => {
      const key = `${handle.platform}:${handle.value}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(handle);
      }
    });
    return unique;
  }, [identitySummary, primaryIdentity]);

  const showOtherButton = useMemo(() => {
    const hasExtraWallet = otherWallets.length > 0;
    const hasExtraBasename = otherBasenames.length > 0;

    if (primaryIdentity) {
      const primaryPlatform = primaryIdentity.platform?.toLowerCase?.() || '';
      if ((primaryPlatform === 'ethereum' || primaryPlatform === 'solana') && hasExtraWallet) {
        return true;
      }
      if (primaryPlatform === 'basenames' && hasExtraBasename) {
        return true;
      }
      return hasExtraWallet || hasExtraBasename;
    }

    const totalWalletHandles = identitySummary?.handles?.filter((handle) => {
      const platform = handle.platform?.toLowerCase?.() || '';
      return platform === 'ethereum' || platform === 'solana';
    }).length ?? 0;

    const totalBasenameHandles = identitySummary?.handles?.filter((handle) => {
      const platform = handle.platform?.toLowerCase?.() || '';
      return platform === 'basenames';
    }).length ?? 0;

    return totalWalletHandles > 1 || totalBasenameHandles > 1;
  }, [otherWallets, otherBasenames, primaryIdentity, identitySummary?.handles]);

  // React Query for Owner Stats
  const { data: ownerStats, isLoading: loading } = useQuery({
    queryKey: ['ownerStats', ownerAddress, plantId],
    queryFn: async () => {
      if (!ownerAddress) return null;
      const [stats, stake] = await Promise.all([
        getUserGameStats(ownerAddress),
        getStakeInfo(ownerAddress)
      ]);
      return {
        totalPlants: stats.totalPlants,
        totalLands: stats.totalLands,
        stakedSeed: stake?.staked || BigInt(0)
      };
    },
    enabled: !!ownerAddress && open,
    staleTime: CACHE_DURATION,
  });

  // React Query for EFP Stats
  const { data: efpStats, isLoading: efpLoading } = useQuery({
    queryKey: ['efpStats', ownerAddress, efpRefreshKey],
    queryFn: async () => {
      if (!ownerAddress) return null;
      return fetchEfpStats(ownerAddress);
    },
    enabled: !!ownerAddress && open,
    staleTime: CACHE_DURATION,
  });

  // Function to refresh EFP stats after follow/unfollow
  const refreshEfpStats = useCallback(() => {
    setEfpRefreshKey(prev => prev + 1);
  }, []);

  // Track previous TransactionModal state to detect when it closes
  const prevTxModalOpenRef = React.useRef(txModalOpen);
  const lastViewedOwnerRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (ownerAddress) {
      lastViewedOwnerRef.current = ownerAddress.toLowerCase();
    }
  }, [ownerAddress]);
  
  // Refresh EFP stats when TransactionModal closes (after follow/unfollow transaction completes)
  useEffect(() => {
    // If TransactionModal was open and now it's closed, refresh stats
    if (prevTxModalOpenRef.current && !txModalOpen) {
      refreshEfpStats();
    }
    prevTxModalOpenRef.current = txModalOpen;
  }, [txModalOpen, refreshEfpStats]);

  if (!ownerAddress) return null;

  const truncatedOwnerAddress = ownerAddress ? formatAddress(ownerAddress, 6, 4) : '';
  const hasPlant = Boolean(plant);
  const showPrimaryLoading = primaryPlantLoading && !hasPlant;
  const displayTitle = isWalletVariant
    ? (ownerName ?? truncatedOwnerAddress)
    : hasPlant && plant
      ? (plant.name ? `${plant.name} (#${plant.id})` : `Plant #${plant.id}`)
      : ownerName ?? truncatedOwnerAddress;
  const displaySubtitle = !isWalletVariant && hasPlant && plant
    ? `Level ${plant.level}${plant.rank ? ` · Rank #${plant.rank}` : ''}`
    : undefined;

  const handleCopyAddress = () => {
    if (!ownerAddress) return;
    navigator.clipboard.writeText(ownerAddress);
    toast.success('Address copied to clipboard');
  };

  const handleViewOnBlockscout = async () => {
    if (!ownerAddress) return;
    await openExternalUrl(`https://base.blockscout.com/address/${ownerAddress}`);
  };

  const handleFollowButtonClick = (state: FollowingState) => {
    if (state !== 'Follow') return;
    if (!connectedAddress || !ownerAddress) return;
    if (connectedAddress.toLowerCase() === ownerAddress.toLowerCase()) return;
    fetch('/api/gamification/missions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: connectedAddress, taskId: 's2_follow_player' })
    }).catch(() => {});
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[440px] p-0">
          <div className="flex flex-col overflow-y-auto overflow-x-hidden">
            <div className="relative">
              <div className="h-32 bg-gradient-to-br from-primary/20 via-primary/10 to-background" />
              <div className="absolute inset-x-6 top-8 flex items-start justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                <span className="pt-1">Powered by:</span>
                <div className="flex flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={() => openExternalUrl('https://efp.app')}
                    className="flex items-center gap-2 transition hover:text-foreground normal-case text-xs font-medium"
                  >
                    <Image src="/icons/efp-logo.svg" alt="EFP" width={16} height={16} />
                    Ethereum Follow Protocol
                  </button>
                  <button
                    type="button"
                    onClick={() => openExternalUrl('https://memoryprotocol.xyz')}
                    className="flex items-center gap-2 transition hover:text-foreground normal-case text-xs font-medium"
                  >
                    <Image src="/icons/memory.png" alt="Memory" width={16} height={16} />
                    Memory Protocol
                  </button>
                </div>
              </div>
              <div className="absolute -bottom-8 left-6">
                <div className="relative">
                  <div
                    className={`w-24 h-24 border-4 border-background bg-background overflow-hidden shadow-lg flex items-center justify-center ${
                      isWalletVariant ? 'rounded-full' : 'rounded-xl'
                    }`}
                  >
                    {showPrimaryLoading ? (
                      <Skeleton className="h-full w-full" />
                    ) : isWalletVariant ? (
                      ownerAddress ? (
                        <Avatar
                          address={ownerAddress as `0x${string}`}
                          chain={base}
                          className="w-full h-full"
                          style={{ width: '100%', height: '100%' }}
                        />
                      ) : (
                        <div className="text-xs text-muted-foreground">No wallet</div>
                      )
                    ) : hasPlant && plant ? (
                      <PlantImage
                        selectedPlant={plant}
                        width={96}
                        height={96}
                      />
                    ) : (
                      <div className="text-xs text-muted-foreground">No plant</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1 px-6 pb-5 pt-6">
          {/* Plant Info */}
          <div className="mt-6 mb-2 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-2xl font-bold truncate">
                {showPrimaryLoading ? <Skeleton className="h-7 w-40" /> : displayTitle}
              </DialogTitle>
              {displaySubtitle && !showPrimaryLoading && (
                <DialogDescription className="text-sm mt-1">
                  {displaySubtitle}
                </DialogDescription>
              )}
              {hasPlant && plant?.timePlantBorn && !showPrimaryLoading && !isWalletVariant && (
                <div className="text-xs text-muted-foreground mt-1">
                  Planted on {new Date(Number(plant.timePlantBorn) * 1000).toLocaleDateString()}
                </div>
              )}
            </div>
            {canShowPostsButton && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3"
                onClick={() => setPostsDialogOpen(true)}
              >
                View X posts{twitterPosts.length > 0 ? ` (${twitterPosts.length})` : ''}
              </Button>
            )}
          </div>

          {/* Plant & Owner Stats Row */}
          <div className="mb-3 flex flex-col gap-2.5 text-sm">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Game Stats</span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {hasPlant && plant && (
                <>
                  <div className="flex items-center gap-1.5">
                    <Image src="/icons/Star.svg" alt="Stars" width={16} height={16} />
                    <span className="font-semibold">{plant.stars}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                    <span className="font-semibold">{formatEthShort(plant.rewards)}</span>
                    <span className="text-xs text-muted-foreground uppercase">Rewards</span>
                  </div>
                </>
              )}
              {loading ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-4 w-8" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-4 w-8" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                </>
              ) : ownerStats ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <Image src="/icons/plant1.svg" alt="Plants" width={16} height={16} />
                    <span className="font-semibold">{ownerStats.totalPlants}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Image src="/icons/bee-house.svg" alt="Lands" width={16} height={16} />
                    <span className="font-semibold">{ownerStats.totalLands}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Image src="/PixotchiKit/COIN.svg" alt="Staked" width={16} height={16} />
                    <span className="font-semibold">{formatStaked(ownerStats.stakedSeed)}</span>
                    <span className="text-xs text-muted-foreground uppercase">Staked</span>
                  </div>
                </>
              ) : null}
            </div>
            {combinedSocialHandles.length > 0 && (
              <div className="mt-3 flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Social Info</span>
                <div className="flex flex-wrap items-center gap-2">
                {combinedSocialHandles.map((handle) => {
                  const Icon = getPlatformIcon(handle.platform);
                  const url = getIdentityUrl(handle.platform, handle.value, handle.url);
                  return (
                    <button
                      key={`${handle.platform}-${handle.value}-inline`}
                      type="button"
                      className={`flex items-center gap-1.5 text-left transition ${url ? 'hover:text-primary' : 'cursor-default text-muted-foreground'}`}
                      onClick={() => {
                        if (url) openExternalUrl(url);
                      }}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="font-semibold">
                        {formatIdentityValue(handle.platform, handle.value)}
                      </span>
                    </button>
                  );
                })}
                </div>
              </div>
            )}
          </div>

          <>
            <div className="space-y-2.5 mb-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Owner</span>
                <div className="flex items-center gap-2">
                  {isNameLoading ? (
                    <Skeleton className="h-4 w-32" />
                  ) : ownerName ? (
                    <span className="text-sm text-primary font-medium">{ownerName}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">No ENS/Basename found</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleCopyAddress}
                className="flex-1 h-10 font-mono text-sm justify-between"
                disabled={!ownerAddress}
              >
                <span className="truncate">{ownerAddress ? formatAddress(ownerAddress, 6, 4) : '—'}</span>
                <Copy className="w-4 h-4 flex-shrink-0" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleViewOnBlockscout}
                className="h-10 w-10 p-0"
                disabled={!ownerAddress}
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
              {showOtherButton && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 px-3"
                  onClick={() => setOtherDialogOpen(true)}
                >
                  Other
                </Button>
              )}
            </div>

          {/* EFP Social Stats - Followers/Following */}
          <div className="flex flex-col items-center gap-1.5 py-3 border-t border-border">
            <div className="flex items-center justify-center gap-3">
            {efpLoading ? (
              <>
                <div className="flex flex-col items-center">
                  <Skeleton className="h-6 w-12 mb-1" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <div className="h-8 w-px bg-border" />
                <div className="flex flex-col items-center">
                  <Skeleton className="h-6 w-12 mb-1" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </>
            ) : efpStats ? (
              <>
                <div className="flex flex-col items-center cursor-pointer hover:opacity-80 transition-opacity">
                  <span className="text-xl font-bold">{formatCount(efpStats.followersCount)}</span>
                  <span className="text-xs text-muted-foreground">Followers</span>
                </div>
                <div className="h-8 w-px bg-border" />
                <div className="flex flex-col items-center cursor-pointer hover:opacity-80 transition-opacity">
                  <span className="text-xl font-bold">{formatCount(efpStats.followingCount)}</span>
                  <span className="text-xs text-muted-foreground">Following</span>
                </div>
              </>
            ) : (
              <span className="text-xs text-muted-foreground italic">No social data available</span>
            )}
            </div>
          </div>

          {/* Follow Button Section */}
          {connectedAddress &&
           ownerAddress &&
           connectedAddress.toLowerCase() !== ownerAddress.toLowerCase() && (
            <div className="flex justify-center pt-4 border-t border-border">
              <div className="w-full">
                <FollowButton
                  lookupAddress={ownerAddress as `0x${string}`}
                  connectedAddress={connectedAddress}
                  customOnClick={handleFollowButtonClick}
                  onDisconnectedClick={() => {
                    toast.error('Please connect your wallet to follow users');
                  }}
                  className="w-full h-10 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                />
              </div>
            </div>
          )}

          </>
          </div>
        </div>
        </DialogContent>
      </Dialog>
      <Dialog open={postsDialogOpen} onOpenChange={setPostsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Recent posts</DialogTitle>
            <DialogDescription>
              {twitterUsername
                ? `Latest ${twitterPosts.length || 10} posts from @${twitterUsername} via Memory Protocol${
                    twitterLastUpdated ? ` • updated ${twitterLastUpdated}` : ''
                  }.`
                : `Latest ${twitterPosts.length || 10} posts via Memory Protocol.`}
            </DialogDescription>
          </DialogHeader>
          {twitterPosts.length > 0 ? (
            <>
              <div className="mb-3 text-xs text-muted-foreground">
                <span>
                  Showing {twitterPosts.length} cached post{twitterPosts.length === 1 ? '' : 's'}.
                </span>
                {twitterLastUpdated ? (
                  <span className="ml-1">
                    Last updated {twitterLastUpdated}.
                  </span>
                ) : null}
              </div>
              <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
              {twitterPosts.map((post: TwitterPostLite) => {
                const postAge = formatTwitterPostAge(post.createdAt);
                const metrics = [
                  { key: 'likes', label: 'Likes', value: post.metrics?.likes, icon: Heart },
                  { key: 'reposts', label: 'Reposts', value: post.metrics?.reposts, icon: Repeat2 },
                  { key: 'quotes', label: 'Quotes', value: post.metrics?.quotes, icon: Quote },
                  { key: 'replies', label: 'Replies', value: post.metrics?.replies, icon: MessageCircle },
                  { key: 'bookmarks', label: 'Bookmarks', value: post.metrics?.bookmarks, icon: Bookmark },
                ].filter((metric) => typeof metric.value === 'number' && (metric.value ?? 0) > 0);
                const mediaCount = Array.isArray(post.media)
                  ? post.media.filter((item: TwitterMediaLite | null | undefined) => item?.url).length
                  : 0;
                return (
                  <div
                    key={post.id}
                    className="rounded-xl border border-border/60 bg-background/95 p-4 shadow-sm transition hover:border-primary/30 hover:shadow-md"
                  >
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {post.text || '(No text)'}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {postAge ? <span>{postAge}</span> : null}
                      {post.url ? (
                        <>
                          <span className="opacity-60">•</span>
                          <a
                            href={post.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" aria-hidden />
                            Open on X
                          </a>
                        </>
                      ) : null}
                    </div>
                    {metrics.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {metrics.map((metric) => {
                          const Icon = metric.icon;
                          return (
                            <span
                              key={metric.key}
                              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 font-medium text-muted-foreground"
                            >
                              <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
                              <span>{metric.value}</span>
                              <span className="sr-only">{metric.label}</span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {mediaCount > 0 && (
                      <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                        <ImageIcon className="h-3.5 w-3.5" aria-hidden />
                        <span>
                          {mediaCount} attachment{mediaCount > 1 ? 's' : ''} available on X
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-4 py-6 text-sm text-muted-foreground">
              {twitterStatus === 'in_progress'
                ? 'Posts are syncing from Memory Protocol. Please check back in a few minutes.'
                : twitterStatus === 'queued'
                  ? 'Post sync has been queued. Try again shortly.'
                  : twitterStatusLabel
                    ? `No cached posts yet (status: ${twitterStatusLabel}).`
                    : 'No cached posts are available yet.'}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={otherDialogOpen} onOpenChange={setOtherDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Other Wallets</DialogTitle>
            <DialogDescription>Addresses associated with this identity</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {otherWallets.map((handle) => {
              const url = getIdentityUrl(handle.platform, handle.value, handle.url);
              const truncated = formatIdentityValue(handle.platform, handle.value);
              return (
                <div
                  key={`${handle.platform}-${handle.value}-modal`}
                  className="flex items-center gap-2"
                >
                  <button
                    type="button"
                    className={`flex flex-1 items-center justify-between rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm transition ${url ? 'hover:border-primary/40 hover:text-primary' : 'cursor-default'}`}
                    onClick={() => {
                      if (url) openExternalUrl(url);
                    }}
                  >
                    <span className="capitalize text-foreground">{handle.platform}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {truncated}
                    </span>
                  </button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => {
                      navigator.clipboard.writeText(handle.value);
                      toast.success('Wallet copied to clipboard');
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            {otherBasenames.length > 0 && (
              <div className="mt-6 space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Other basenames</span>
                {otherBasenames.map((handle) => (
                  <button
                    key={`${handle.platform}-${handle.value}-basename-modal`}
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm transition hover:border-primary/40 hover:text-primary"
                    onClick={() => {
                      const url = handle.url ?? `https://www.base.org/name/${handle.value}`;
                      openExternalUrl(url);
                    }}
                  >
                    <span className="text-foreground">{handle.value}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
