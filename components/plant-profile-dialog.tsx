"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StandardContainer } from '@/components/ui/pixel-container';
import { Copy, ExternalLink, Globe as GlobeIcon, Mail as MailIcon } from 'lucide-react';
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
import { FollowButton, useTransactions } from 'ethereum-identity-kit';

interface PlantProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plant: Plant & { rank?: number } | null;
}

interface OwnerStats {
  totalPlants: number;
  totalLands: number;
  stakedSeed: bigint;
}

interface CachedOwnerData {
  stats: OwnerStats;
  timestamp: number;
  plantId: number;
}

interface CachedEFPData {
  stats: EthFollowStats;
  timestamp: number;
}

// Cache owner stats to prevent excessive RPC calls
const ownerStatsCache = new Map<string, CachedOwnerData>();
const efpStatsCache = new Map<string, CachedEFPData>();
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
    return `https://basescan.org/address/${value}`;
  }
  if (lower === 'solana') {
    return `https://solscan.io/account/${value}`;
  }
  return null;
};

export default function PlantProfileDialog({ open, onOpenChange, plant }: PlantProfileDialogProps) {
  const [ownerStats, setOwnerStats] = useState<OwnerStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [efpStats, setEfpStats] = useState<EthFollowStats | null>(null);
  const [efpLoading, setEfpLoading] = useState(false);
  const [efpError, setEfpError] = useState<string | null>(null);
  const [otherDialogOpen, setOtherDialogOpen] = useState(false);
  const [efpRefreshKey, setEfpRefreshKey] = useState(0);

  // Get connected wallet address
  const { address: connectedAddress } = useAccount();
  
  // Get TransactionModal state to detect when it's open/closed
  const { txModalOpen } = useTransactions();
  
  // Close plant profile dialog when TransactionModal opens
  useEffect(() => {
    if (txModalOpen && open) {
      onOpenChange(false);
    }
  }, [txModalOpen, open, onOpenChange]);

  // Resolve ENS/Basename using shared resolver
  const { name: ownerName, loading: isNameLoading } = usePrimaryName(plant?.owner);
  const ownerAddress = plant?.owner ?? null;
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
  const platformHighlights = identitySummary?.platforms.slice(0, 3) ?? [];
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
  const secondaryIdentities = primaryIdentity ? primaryIdentities.slice(1) : primaryIdentities;
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

  useEffect(() => {
    if (!plant || !open) {
      setOwnerStats(null);
      return;
    }

    let cancelled = false;

    // Check cache first
    const cacheKey = plant.owner.toLowerCase();
    const cached = ownerStatsCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < CACHE_DURATION && cached.plantId === plant.id) {
      // Use cached data
      setOwnerStats(cached.stats);
      setLoading(false);
      return;
    }

    // Fetch fresh data
    setLoading(true);

    Promise.all([
      getUserGameStats(plant.owner),
      getStakeInfo(plant.owner)
    ])
      .then(([stats, stake]) => {
        if (cancelled) return;
        
        const ownerData: OwnerStats = {
          totalPlants: stats.totalPlants,
          totalLands: stats.totalLands,
          stakedSeed: stake?.staked || BigInt(0)
        };
        
        setOwnerStats(ownerData);
        
        // Cache the data
        ownerStatsCache.set(cacheKey, {
          stats: ownerData,
          timestamp: now,
          plantId: plant.id
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Error fetching owner stats:', err);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [plant?.id, plant?.owner, open]);

  // Fetch EFP stats (followers/following)
  useEffect(() => {
    if (!plant || !open) {
      setEfpStats(null);
      setEfpError(null);
      return;
    }

    let cancelled = false;

    // Check cache first - use timestamp-based TTL
    const cacheKey = plant.owner.toLowerCase();
    const cached = efpStatsCache.get(cacheKey);
    const now = Date.now();

    // Use cache if it's fresh (within CACHE_DURATION) and we haven't manually refreshed
    if (cached && (now - cached.timestamp) < CACHE_DURATION && efpRefreshKey === 0) {
      setEfpStats(cached.stats);
      setEfpError(null);
      setEfpLoading(false);
      return;
    }

    // Fetch fresh EFP data
    setEfpLoading(true);
    setEfpError(null);

    const addressForEfp = plant.owner;

    fetchEfpStats(addressForEfp)
      .then((stats) => {
        if (cancelled) return;
        
        if (stats) {
          setEfpStats(stats);
          setEfpError(null);
          // Cache the data
          efpStatsCache.set(cacheKey, {
            stats,
            timestamp: now,
          });
        } else {
          setEfpStats(null);
          setEfpError(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Error fetching EFP stats:', err);
        setEfpStats(null);
        setEfpError('Failed to load follow stats');
      })
      .finally(() => {
        if (cancelled) return;
        setEfpLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [plant?.owner, ownerName, open, efpRefreshKey]);

  // Function to refresh EFP stats after follow/unfollow
  const refreshEfpStats = useCallback(() => {
    setEfpRefreshKey(prev => prev + 1);
  }, []);

  // Track previous TransactionModal state to detect when it closes
  const prevTxModalOpenRef = React.useRef(txModalOpen);
  const lastViewedOwnerRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (plant?.owner) {
      lastViewedOwnerRef.current = plant.owner.toLowerCase();
    }
  }, [plant?.owner]);
  
  // Refresh EFP stats when TransactionModal closes (after follow/unfollow transaction completes)
  useEffect(() => {
    // If TransactionModal was open and now it's closed, refresh stats
    if (prevTxModalOpenRef.current && !txModalOpen) {
      refreshEfpStats();
    }
    prevTxModalOpenRef.current = txModalOpen;
  }, [txModalOpen, refreshEfpStats]);

  // Reset view when dialog closes
  useEffect(() => {
    if (!open) {
      // setViewingENSDetails(false); // Removed
      // setEnsData(null); // Removed
    }
  }, [open]);

  if (!plant) return null;

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(plant.owner);
    toast.success('Address copied to clipboard');
  };

  const handleViewOnBaseScan = async () => {
    await openExternalUrl(`https://basescan.org/address/${plant.owner}`);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[440px]">
          {/* Header with Plant Image */}
          <div className="relative -mt-6 -mx-6 mb-4">
            <div className="h-32 bg-gradient-to-br from-primary/20 via-primary/10 to-background rounded-t-xl" />
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
                <div className="flex items-center gap-2 normal-case text-xs font-medium">
                  <Image src="/icons/memory.png" alt="Memory" width={16} height={16} />
                  Memory Protocol
                </div>
              </div>
            </div>
            <div className="absolute -bottom-14 left-6">
              <div className="relative">
                <div className="w-24 h-24 rounded-xl border-4 border-background bg-background overflow-hidden shadow-lg">
                  <PlantImage selectedPlant={plant} width={96} height={96} />
                </div>
              </div>
            </div>
          </div>

          {/* Plant Info */}
          <div className="mt-14 mb-4">
            <DialogTitle className="text-2xl font-bold truncate">
              {plant.name ? `${plant.name} (#${plant.id})` : `Plant #${plant.id}`}
            </DialogTitle>
            <DialogDescription className="text-sm mt-1">
              Level {plant.level} {plant.rank && `· Rank #${plant.rank}`}
            </DialogDescription>
            {plant.timePlantBorn && (
              <div className="text-xs text-muted-foreground mt-1">
                Planted on {new Date(Number(plant.timePlantBorn) * 1000).toLocaleDateString()}
              </div>
            )}
          </div>

          {/* Plant & Owner Stats Row */}
          <div className="mb-5 flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-1.5">
                <Image src="/icons/Star.svg" alt="Stars" width={16} height={16} />
                <span className="font-semibold">{plant.stars}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                <span className="font-semibold">{formatEthShort(plant.rewards)}</span>
                <span className="text-xs text-muted-foreground uppercase">Rewards</span>
              </div>
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
            )}
          </div>

          {/* Conditional Content: Main Profile Only */}
          {/* Main Profile View */}
          <>
            {/* Owner Section */}
            <div className="space-y-3 mb-5">
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
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleCopyAddress}
                className="flex-1 h-10 font-mono text-sm justify-between"
              >
                <span className="truncate">{formatAddress(plant.owner, 6, 4)}</span>
                <Copy className="w-4 h-4 flex-shrink-0" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleViewOnBaseScan}
                className="h-10 w-10 p-0"
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
          </div>

          {/* EFP Social Stats - Followers/Following */}
          <div className="flex flex-col items-center gap-2 py-3 border-t border-border">
            <div className="flex items-center justify-center gap-6">
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
           plant?.owner && 
           connectedAddress.toLowerCase() !== plant.owner.toLowerCase() && (
            <div className="flex justify-center pt-4 border-t border-border">
              <div className="w-full">
                <FollowButton
                  lookupAddress={plant.owner as `0x${string}`}
                  connectedAddress={connectedAddress}
                  onDisconnectedClick={() => {
                    toast.error('Please connect your wallet to follow users');
                  }}
                  className="w-full h-10 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                />
              </div>
            </div>
          )}

          </>
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

