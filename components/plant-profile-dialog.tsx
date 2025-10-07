"use client";

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Star, Copy, ExternalLink } from 'lucide-react';
import Image from 'next/image';
import PlantImage from '@/components/PlantImage';
import { getUserGameStats } from '@/lib/user-stats-service';
import { getStakeInfo } from '@/lib/contracts';
import { formatEthShort } from '@/lib/utils';
import { openExternalUrl } from '@/lib/open-external';
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
  ens: string | null;
}

interface CachedOwnerData {
  stats: OwnerStats;
  timestamp: number;
  plantId: number;
}

// Cache owner stats to prevent excessive RPC calls
const ownerStatsCache = new Map<string, CachedOwnerData>();
const CACHE_DURATION = 30000; // 30 seconds

function formatStaked(amount: bigint): string {
  const num = Number(amount) / 1e18;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toFixed(0);
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function fetchENS(address: string): Promise<string | null> {
  try {
    const resp = await fetch(`https://api.ensideas.com/ens/resolve/${encodeURIComponent(address)}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.name || data?.display || null;
  } catch {
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
      getStakeInfo(plant.owner),
      fetchENS(plant.owner).catch(() => null)
    ])
      .then(([stats, stake, ens]) => {
        if (cancelled) return;
        
        const ownerData: OwnerStats = {
          totalPlants: stats.totalPlants,
          totalLands: stats.totalLands,
          stakedSeed: stake?.staked || BigInt(0),
          ens: ens
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
          <div className="absolute -bottom-12 left-6">
            <div className="relative">
              <div className="w-24 h-24 rounded-xl border-4 border-background bg-background overflow-hidden shadow-lg">
                <PlantImage selectedPlant={plant} width={96} height={96} />
              </div>
            </div>
          </div>
        </div>

        {/* Plant Info */}
        <div className="mt-10 mb-4">
          <DialogTitle className="text-2xl font-bold truncate">
            {plant.name || `Plant #${plant.id}`}
          </DialogTitle>
          <DialogDescription className="text-sm mt-1">
            Level {plant.level} {plant.rank && `· Rank #${plant.rank}`}
          </DialogDescription>
        </div>

        {/* Plant Stats Row */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <Card className="border-yellow-500/20 bg-yellow-500/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
                  <Star className="w-5 h-5 fill-yellow-400 text-yellow-400" />
                </div>
                <div className="min-w-0">
                  <div className="text-2xl font-bold">{plant.stars}</div>
                  <div className="text-xs text-muted-foreground">Stars</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-blue-500/20 bg-blue-500/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <Image src="/icons/ethlogo.svg" alt="ETH" width={20} height={20} />
                </div>
                <div className="min-w-0">
                  <div className="text-2xl font-bold truncate">{formatEthShort(plant.rewards)}</div>
                  <div className="text-xs text-muted-foreground">ETH</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Owner Section */}
        <div className="space-y-3 mb-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Owner</span>
            {ownerStats?.ens && (
              <span className="text-sm text-primary font-medium">{ownerStats.ens}</span>
            )}
          </div>
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleCopyAddress}
            className="w-full h-10 font-mono text-sm justify-between"
          >
            <span className="truncate">{formatAddress(plant.owner)}</span>
            <Copy className="w-4 h-4 flex-shrink-0" />
          </Button>
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
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                    <Image src="/icons/plant1.svg" alt="Plants" width={20} height={20} />
                  </div>
                  <div className="text-2xl font-bold">{ownerStats.totalPlants}</div>
                  <div className="text-xs text-muted-foreground">Plants</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center">
                    <Image src="/icons/landIcon.png" alt="Lands" width={20} height={20} />
                  </div>
                  <div className="text-2xl font-bold">{ownerStats.totalLands}</div>
                  <div className="text-xs text-muted-foreground">Lands</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">
                    <Image src="/PixotchiKit/COIN.svg" alt="Staked" width={20} height={20} />
                  </div>
                  <div className="text-2xl font-bold">{formatStaked(ownerStats.stakedSeed)}</div>
                  <div className="text-xs text-muted-foreground">Staked</div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {/* BaseScan Button */}
        <Button 
          variant="outline" 
          size="sm"
          onClick={handleViewOnBaseScan}
          className="w-full"
        >
          View on BaseScan
          <ExternalLink className="w-4 h-4 ml-2" />
        </Button>
      </DialogContent>
    </Dialog>
  );
}

