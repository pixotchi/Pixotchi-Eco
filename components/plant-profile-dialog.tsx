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
      <DialogContent className="max-w-[420px]">
        <DialogHeader className="pb-2">
          <DialogTitle className="flex items-center gap-2">
            <PlantImage selectedPlant={plant} width={32} height={32} />
            <span className="truncate">{plant.name || `Plant #${plant.id}`}</span>
          </DialogTitle>
          <DialogDescription className="text-left">
            Level {plant.level} {plant.rank && `· Rank #${plant.rank}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Plant Stats */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-6">
                <div className="flex flex-col items-center justify-center">
                  <div className="text-3xl font-bold mb-1">{plant.stars}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                    <span>Stars</span>
                  </div>
                </div>
                <div className="flex flex-col items-center justify-center">
                  <div className="text-3xl font-bold mb-1">{formatEthShort(plant.rewards)}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Image src="/icons/ethlogo.svg" alt="ETH" width={12} height={12} />
                    <span>ETH Rewards</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Owner Info */}
          <div className="space-y-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Owner</div>
            <div className="flex flex-col gap-2">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={handleCopyAddress}
                className="h-9 px-3 text-sm font-mono justify-start hover:bg-muted/50"
              >
                <span className="truncate">{formatAddress(plant.owner)}</span>
                <Copy className="w-3.5 h-3.5 ml-2 flex-shrink-0" />
              </Button>
              {ownerStats?.ens && (
                <div className="text-sm text-primary font-medium px-3">{ownerStats.ens}</div>
              )}
            </div>
          </div>

          {/* Owner Stats */}
          {loading ? (
            <SkeletonLoader />
          ) : error ? (
            <Card>
              <CardContent className="p-4">
                <div className="text-center text-sm text-muted-foreground">
                  {error}
                </div>
              </CardContent>
            </Card>
          ) : ownerStats ? (
            <Card>
              <CardContent className="p-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col items-center justify-center">
                    <div className="text-2xl font-bold mb-1">{ownerStats.totalPlants}</div>
                    <div className="text-xs text-muted-foreground">Plants</div>
                  </div>
                  <div className="flex flex-col items-center justify-center">
                    <div className="text-2xl font-bold mb-1">{ownerStats.totalLands}</div>
                    <div className="text-xs text-muted-foreground">Lands</div>
                  </div>
                  <div className="flex flex-col items-center justify-center">
                    <div className="text-2xl font-bold mb-1">{formatStaked(ownerStats.stakedSeed)}</div>
                    <div className="text-xs text-muted-foreground">Staked</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <DialogFooter className="pt-4">
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleViewOnBaseScan}
            className="w-full"
          >
            View on BaseScan
            <ExternalLink className="w-3.5 h-3.5 ml-2" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

