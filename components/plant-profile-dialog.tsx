"use client";

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Copy, ExternalLink, ArrowLeft, Eye } from 'lucide-react';
import Image from 'next/image';
import PlantImage from '@/components/PlantImage';
import { getUserGameStats } from '@/lib/user-stats-service';
import { getStakeInfo } from '@/lib/contracts';
import { formatEthShort, formatTokenAmount } from '@/lib/utils';
import { openExternalUrl } from '@/lib/open-external';
import { useName } from '@coinbase/onchainkit/identity';
import { base } from 'viem/chains';
import toast from 'react-hot-toast';
import type { Plant } from '@/lib/types';

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

interface EFPStats {
  followersCount: number;
  followingCount: number;
}

interface ENSData {
  name: string;
  address: string;
  avatar?: string;
  records?: {
    avatar?: string;
    'com.discord'?: string;
    'com.github'?: string;
    'com.twitter'?: string;
    description?: string;
    email?: string;
    header?: string;
    location?: string;
    name?: string;
    'org.telegram'?: string;
    url?: string;
  };
  updated_at?: string;
}

interface CachedOwnerData {
  stats: OwnerStats;
  timestamp: number;
  plantId: number;
}

interface CachedEFPData {
  stats: EFPStats;
  timestamp: number;
}

interface CachedENSData {
  data: ENSData;
  timestamp: number;
}

// Cache owner stats to prevent excessive RPC calls
const ownerStatsCache = new Map<string, CachedOwnerData>();
const efpStatsCache = new Map<string, CachedEFPData>();
const ensDataCache = new Map<string, CachedENSData>();
const CACHE_DURATION = 120000; // 2 minutes

const formatStaked = (amount: bigint) => formatTokenAmount(amount, 18);

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

async function fetchEFPStats(addressOrENS: string): Promise<EFPStats | null> {
  try {
    const resp = await fetch(`https://api.ethfollow.xyz/api/v1/users/${encodeURIComponent(addressOrENS)}/stats`);
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      followersCount: parseInt(data.followers_count || '0', 10),
      followingCount: parseInt(data.following_count || '0', 10),
    };
  } catch (error) {
    console.error('EFP stats fetch error:', error);
    return null;
  }
}

async function fetchENSData(addressOrENS: string): Promise<ENSData | null> {
  try {
    const resp = await fetch(`https://api.ethfollow.xyz/api/v1/users/${encodeURIComponent(addressOrENS)}/ens`);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.ens || null;
  } catch (error) {
    console.error('ENS data fetch error:', error);
    return null;
  }
}

export default function PlantProfileDialog({ open, onOpenChange, plant }: PlantProfileDialogProps) {
  const [ownerStats, setOwnerStats] = useState<OwnerStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [efpStats, setEfpStats] = useState<EFPStats | null>(null);
  const [efpLoading, setEfpLoading] = useState(false);
  const [viewingENSDetails, setViewingENSDetails] = useState(false);
  const [ensData, setEnsData] = useState<ENSData | null>(null);
  const [ensLoading, setEnsLoading] = useState(false);

  // Use OnchainKit's useName hook for ENS/Basename resolution
  const { data: ownerName, isLoading: isNameLoading } = useName({
    address: (plant?.owner as `0x${string}`) ?? "0x0000000000000000000000000000000000000000",
    chain: base,
  });

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
      return;
    }

    let cancelled = false;

    // Check cache first
    const cacheKey = plant.owner.toLowerCase();
    const cached = efpStatsCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      setEfpStats(cached.stats);
      setEfpLoading(false);
      return;
    }

    // Fetch fresh EFP data
    setEfpLoading(true);

    // Prefer ENS name if available, otherwise use address
    const addressOrENS = ownerName || plant.owner;

    fetchEFPStats(addressOrENS)
      .then((stats) => {
        if (cancelled) return;
        
        if (stats) {
          setEfpStats(stats);
          // Cache the data
          efpStatsCache.set(cacheKey, {
            stats,
            timestamp: now,
          });
        } else {
          setEfpStats(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Error fetching EFP stats:', err);
        setEfpStats(null);
      })
      .finally(() => {
        if (cancelled) return;
        setEfpLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [plant?.owner, ownerName, open]);

  // Reset view when dialog closes
  useEffect(() => {
    if (!open) {
      setViewingENSDetails(false);
      setEnsData(null);
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

  const handleViewENSDetails = async () => {
    if (!ownerName) return;

    // Check cache first
    const cacheKey = plant.owner.toLowerCase();
    const cached = ensDataCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      setEnsData(cached.data);
      setViewingENSDetails(true);
      return;
    }

    // Fetch fresh data
    setEnsLoading(true);
    const data = await fetchENSData(ownerName);
    setEnsLoading(false);

    if (data) {
      setEnsData(data);
      ensDataCache.set(cacheKey, {
        data,
        timestamp: now,
      });
      setViewingENSDetails(true);
    } else {
      toast.error('Failed to load ENS data');
    }
  };

  const handleBackToProfile = () => {
    setViewingENSDetails(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        {/* Header with Plant Image */}
        <div className="relative -mt-6 -mx-6 mb-4">
          <div className="h-32 bg-gradient-to-br from-primary/20 via-primary/10 to-background rounded-t-xl" />
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
        </div>

        {/* Plant & Owner Stats Row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-5 text-sm">
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

        {/* Conditional Content: Main Profile or ENS Details */}
        {viewingENSDetails ? (
          /* ENS Details View */
          <div className="space-y-4">
            {/* Back Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleBackToProfile}
              className="mb-2"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Profile
            </Button>

            {/* ENS Data Display */}
            {ensData && (
              <div className="space-y-4">
                {/* Avatar & Header */}
                {ensData.records?.header && (
                  <div className="relative w-full h-24 rounded-lg overflow-hidden bg-muted">
                    <img 
                      src={ensData.records.header} 
                      alt="ENS Header" 
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                {ensData.avatar && (
                  <div className="flex justify-center -mt-8">
                    <div className="w-20 h-20 rounded-full border-4 border-background overflow-hidden bg-muted">
                      <img 
                        src={ensData.avatar} 
                        alt="ENS Avatar" 
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                )}

                {/* ENS Name */}
                <div className="text-center">
                  <h3 className="text-xl font-bold">{ensData.name}</h3>
                  {ensData.records?.name && ensData.records.name !== ensData.name && (
                    <p className="text-sm text-muted-foreground mt-1">{ensData.records.name}</p>
                  )}
                </div>

                {/* Description */}
                {ensData.records?.description && (
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {ensData.records.description}
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* Social & Contact Links */}
                <div className="space-y-2">
                  {ensData.records?.url && (
                    <Card>
                      <CardContent className="p-3 flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground uppercase">Website</span>
                        <button
                          type="button"
                          onClick={() => openExternalUrl(ensData.records!.url!)}
                          className="text-sm text-primary hover:underline truncate max-w-[60%] text-left"
                        >
                          {ensData.records.url}
                        </button>
                      </CardContent>
                    </Card>
                  )}

                  {ensData.records?.location && (
                    <Card>
                      <CardContent className="p-3 flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground uppercase">Location</span>
                        <span className="text-sm">{ensData.records.location}</span>
                      </CardContent>
                    </Card>
                  )}

                  {ensData.records?.email && (
                    <Card>
                      <CardContent className="p-3 flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground uppercase">Email</span>
                        <button
                          type="button"
                          onClick={() => openExternalUrl(`mailto:${ensData.records!.email!}`)}
                          className="text-sm text-primary hover:underline truncate max-w-[60%] text-left"
                        >
                          {ensData.records.email}
                        </button>
                      </CardContent>
                    </Card>
                  )}

                  {ensData.records?.['com.twitter'] && (
                    <Card>
                      <CardContent className="p-3 flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground uppercase">Twitter</span>
                        <button
                          type="button"
                          onClick={() => openExternalUrl(`https://twitter.com/${ensData.records!['com.twitter']!}`)}
                          className="text-sm text-primary hover:underline"
                        >
                          @{ensData.records['com.twitter']}
                        </button>
                      </CardContent>
                    </Card>
                  )}

                  {ensData.records?.['com.github'] && (
                    <Card>
                      <CardContent className="p-3 flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground uppercase">GitHub</span>
                        <button
                          type="button"
                          onClick={() => openExternalUrl(`https://github.com/${ensData.records!['com.github']!}`)}
                          className="text-sm text-primary hover:underline"
                        >
                          @{ensData.records['com.github']}
                        </button>
                      </CardContent>
                    </Card>
                  )}

                  {ensData.records?.['com.discord'] && (
                    <Card>
                      <CardContent className="p-3 flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground uppercase">Discord</span>
                        <span className="text-sm">{ensData.records['com.discord']}</span>
                      </CardContent>
                    </Card>
                  )}

                  {ensData.records?.['org.telegram'] && (
                    <Card>
                      <CardContent className="p-3 flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground uppercase">Telegram</span>
                        <span className="text-sm">@{ensData.records['org.telegram']}</span>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* Updated At */}
                {ensData.updated_at && (
                  <p className="text-xs text-muted-foreground text-center">
                    Last updated: {new Date(ensData.updated_at).toLocaleDateString()}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Main Profile View */
          <>
            {/* Owner Section */}
        <div className="space-y-3 mb-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Owner</span>
            <div className="flex items-center gap-2">
              {isNameLoading ? (
                <Skeleton className="h-4 w-32" />
              ) : ownerName ? (
                <>
                  <span className="text-sm text-primary font-medium">{ownerName}</span>
                  <button
                    type="button"
                    onClick={handleViewENSDetails}
                    disabled={ensLoading}
                    className="inline-flex items-center justify-center px-2 py-0.5 text-xs leading-none whitespace-nowrap rounded-md bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 btn-compact disabled:opacity-50"
                    aria-label="View ENS details"
                  >
                    {ensLoading ? '...' : <Eye className="w-3 h-3" />}
                  </button>
                </>
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
              <span className="truncate">{formatAddress(plant.owner)}</span>
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
          </div>
        </div>

        {/* EFP Social Stats - Followers/Following */}
        <div className="flex flex-col items-center gap-2 py-3 border-y border-border">
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
          <button
            type="button"
            onClick={() => openExternalUrl('https://efp.app')}
            className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Image src="/icons/efp-logo.svg" alt="EFP" width={12} height={12} />
            Ethereum Follow Protocol
          </button>
        </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

