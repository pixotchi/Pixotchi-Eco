"use client";

import React, { useState, useEffect, useEffectEvent } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Copy, ExternalLink, ArrowLeft } from 'lucide-react';
import Image from 'next/image';
import PlantImage from '@/components/PlantImage';
import { getUserGameStats } from '@/lib/user-stats-service';
import { getStakeInfo } from '@/lib/contracts';
import { formatEthShort, formatTokenAmount, formatAddress } from '@/lib/utils';
import { openExternalUrl } from '@/lib/open-external';
import { usePrimaryName } from '@/components/hooks/usePrimaryName';
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

  // Resolve ENS/Basename using shared resolver
  const { name: ownerName, loading: isNameLoading } = usePrimaryName(plant?.owner);

  // ✅ useEffectEvent: Fetch owner stats without effect dependencies
  const fetchOwnerStats = useEffectEvent(async () => {
    if (!plant || !open) {
      setOwnerStats(null);
      return;
    }

    const cacheKey = plant.owner.toLowerCase();
    const cached = ownerStatsCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < CACHE_DURATION && cached.plantId === plant.id) {
      setOwnerStats(cached.stats);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const [stats, stake] = await Promise.all([
        getUserGameStats(plant.owner),
        getStakeInfo(plant.owner)
      ]);
      
      const ownerData: OwnerStats = {
        totalPlants: stats.totalPlants,
        totalLands: stats.totalLands,
        stakedSeed: stake?.staked || BigInt(0)
      };
      
      setOwnerStats(ownerData);
      
      ownerStatsCache.set(cacheKey, {
        stats: ownerData,
        timestamp: now,
        plantId: plant.id
      });
    } catch (err) {
      console.error('Error fetching owner stats:', err);
    } finally {
      setLoading(false);
    }
  });

  // ✅ useEffectEvent: Fetch EFP stats without depending on ownerName changes
  const fetchEFPStatsData = useEffectEvent(async () => {
    if (!plant || !open) {
      setEfpStats(null);
      return;
    }

    const cacheKey = plant.owner.toLowerCase();
    const cached = efpStatsCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      setEfpStats(cached.stats);
      setEfpLoading(false);
      return;
    }

    setEfpLoading(true);

    const addressOrENS = ownerName || plant.owner;

    try {
      const stats = await fetchEFPStats(addressOrENS);
      
      if (stats) {
        setEfpStats(stats);
        efpStatsCache.set(cacheKey, {
          stats,
          timestamp: now,
        });
      } else {
        setEfpStats(null);
      }
    } catch (err) {
      console.error('Error fetching EFP stats:', err);
      setEfpStats(null);
    } finally {
      setEfpLoading(false);
    }
  });

  // Fetch owner stats when plant or dialog opens
  useEffect(() => {
    fetchOwnerStats();
  }, [plant?.id, plant?.owner, open, fetchOwnerStats]);

  // Fetch EFP stats when plant or dialog opens
  useEffect(() => {
    fetchEFPStatsData();
  }, [plant?.owner, open, fetchEFPStatsData]);

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
      </DialogContent>
    </Dialog>
  );
}

