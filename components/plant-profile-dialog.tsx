"use client";

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Copy, ExternalLink } from 'lucide-react';
import Image from 'next/image';
import PlantImage from '@/components/PlantImage';
import { getUserGameStats } from '@/lib/user-stats-service';
import { getStakeInfo } from '@/lib/contracts';
import { formatEthShort } from '@/lib/utils';
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

interface CachedOwnerData {
  stats: OwnerStats;
  timestamp: number;
  plantId: number;
}

interface CachedEFPData {
  stats: EFPStats;
  timestamp: number;
}

// Cache owner stats to prevent excessive RPC calls
const ownerStatsCache = new Map<string, CachedOwnerData>();
const efpStatsCache = new Map<string, CachedEFPData>();
const CACHE_DURATION = 120000; // 2 minutes

function formatStaked(amount: bigint): string {
  const num = Number(amount) / 1e18;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toFixed(0);
}

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

function SkeletonLoader() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col items-center justify-center">
              <div className="h-8 w-16 bg-muted animate-pulse rounded mb-2" />
              <div className="h-3 w-12 bg-muted animate-pulse rounded" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function PlantProfileDialog({ open, onOpenChange, plant }: PlantProfileDialogProps) {
  const [ownerStats, setOwnerStats] = useState<OwnerStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [efpStats, setEfpStats] = useState<EFPStats | null>(null);
  const [efpLoading, setEfpLoading] = useState(false);

  // Use OnchainKit's useName hook for ENS/Basename resolution
  const { data: ownerName, isLoading: isNameLoading } = useName({
    address: (plant?.owner as `0x${string}`) ?? "0x0000000000000000000000000000000000000000",
    chain: base,
  });

  useEffect(() => {
    if (!plant || !open) {
      setOwnerStats(null);
      setError(null);
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
    setError(null);

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
        setError('Failed to load owner data');
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

  if (!plant) return null;

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(plant.owner);
    toast.success('Address copied to clipboard');
  };

  const handleViewOnBaseScan = async () => {
    await openExternalUrl(`https://basescan.org/address/${plant.owner}`);
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

        {/* Plant Stats Row */}
        <div className="flex items-center gap-4 mb-5 text-sm">
          <div className="flex items-center gap-1.5">
            <Image src="/icons/Star.svg" alt="Stars" width={16} height={16} />
            <span className="font-semibold">{plant.stars}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
            <span className="font-semibold">{formatEthShort(plant.rewards)}</span>
            <span className="text-xs text-muted-foreground uppercase">Rewards</span>
          </div>
        </div>

        {/* Owner Section */}
        <div className="space-y-3 mb-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Owner</span>
            {isNameLoading ? (
              <Skeleton className="h-4 w-32" />
            ) : ownerName ? (
              <span className="text-sm text-primary font-medium">{ownerName}</span>
            ) : (
              <span className="text-xs text-muted-foreground italic">No ENS/Basename found</span>
            )}
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
        <div className="flex items-center justify-center gap-6 py-3 mb-5 border-y border-border">
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

        {/* Owner Stats */}
        {loading ? (
          <SkeletonLoader />
        ) : error ? (
          <Card>
            <CardContent className="p-4">
              <div className="text-center text-sm text-muted-foreground">{error}</div>
            </CardContent>
          </Card>
        ) : ownerStats ? (
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-col items-center gap-2">
                  <Image src="/icons/plant1.svg" alt="Plants" width={24} height={24} />
                  <div className="text-2xl font-bold">{ownerStats.totalPlants}</div>
                  <div className="text-xs text-muted-foreground">Plants</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-col items-center gap-2">
                  <Image src="/icons/landIcon.png" alt="Lands" width={24} height={24} />
                  <div className="text-2xl font-bold">{ownerStats.totalLands}</div>
                  <div className="text-xs text-muted-foreground">Lands</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-col items-center gap-2">
                  <Image src="/PixotchiKit/COIN.svg" alt="Staked" width={24} height={24} />
                  <div className="text-2xl font-bold">{formatStaked(ownerStats.stakedSeed)}</div>
                  <div className="text-xs text-muted-foreground">Staked</div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

