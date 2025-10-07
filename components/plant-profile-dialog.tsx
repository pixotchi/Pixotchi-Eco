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
      <CardContent className="pt-6">
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="text-center">
              <div className="h-8 bg-muted animate-pulse rounded mb-2" />
              <div className="h-4 bg-muted animate-pulse rounded w-12 mx-auto" />
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
    setLoading(true);
    setError(null);

    Promise.all([
      getUserGameStats(plant.owner),
      getStakeInfo(plant.owner),
      fetchENS(plant.owner).catch(() => null)
    ])
      .then(([stats, stake, ens]) => {
        if (cancelled) return;
        setOwnerStats({
          totalPlants: stats.totalPlants,
          totalLands: stats.totalLands,
          stakedSeed: stake?.staked || BigInt(0),
          ens: ens
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
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlantImage selectedPlant={plant} width={32} height={32} />
            {plant.name || `Plant #${plant.id}`}
          </DialogTitle>
          <DialogDescription>
            Level {plant.level} {plant.rank && `· Rank #${plant.rank}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Plant Stats */}
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold">{plant.stars}</div>
                  <div className="text-sm text-muted-foreground flex items-center justify-center gap-1 mt-1">
                    <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                    Stars
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{formatEthShort(plant.rewards)}</div>
                  <div className="text-sm text-muted-foreground flex items-center justify-center gap-1 mt-1">
                    <Image src="/icons/ethlogo.svg" alt="ETH" width={14} height={14} />
                    ETH Rewards
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Owner Info */}
          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground">Owner</div>
            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={handleCopyAddress}
                className="h-8 px-2 text-sm"
              >
                {formatAddress(plant.owner)}
                <Copy className="w-3 h-3 ml-2" />
              </Button>
            </div>
            {ownerStats?.ens && (
              <div className="text-sm text-primary font-medium">{ownerStats.ens}</div>
            )}
          </div>

          {/* Owner Stats */}
          {loading ? (
            <SkeletonLoader />
          ) : error ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center text-sm text-muted-foreground">
                  {error}
                </div>
              </CardContent>
            </Card>
          ) : ownerStats ? (
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-3 gap-2 sm:gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold">{ownerStats.totalPlants}</div>
                    <div className="text-xs text-muted-foreground mt-1">Plants</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{ownerStats.totalLands}</div>
                    <div className="text-xs text-muted-foreground mt-1">Lands</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{formatStaked(ownerStats.stakedSeed)}</div>
                    <div className="text-xs text-muted-foreground mt-1">Staked</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <DialogFooter>
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleViewOnBaseScan}
            className="w-full sm:w-auto"
          >
            View on BaseScan
            <ExternalLink className="w-3 h-3 ml-2" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

