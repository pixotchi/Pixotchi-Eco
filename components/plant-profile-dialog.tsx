"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Copy, ExternalLink } from 'lucide-react';
import Image from 'next/image';
import PlantImage from '@/components/PlantImage';
import { getUserGameStats } from '@/lib/user-stats-service';
import { getStakeInfo } from '@/lib/contracts';
import { formatEthShort, formatTokenAmount, formatAddress } from '@/lib/utils';
import { openExternalUrl } from '@/lib/open-external';
import { usePrimaryName } from '@/components/hooks/usePrimaryName';
import toast from 'react-hot-toast';
import type { Plant } from '@/lib/types';
import { fetchEfpStats } from '@/lib/efp-service';
import { useAccount } from 'wagmi';
import { FollowButton, fetchFollowState, useTransactions } from 'ethereum-identity-kit';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { postMissionProgress } from '@/lib/mission-tracking';
import { WalletAvatar } from '@/components/ui/wallet-avatar';

interface PlantProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plant: (Plant & { rank?: number }) | null;
  variant?: 'plant' | 'wallet';
  walletAddressOverride?: string | null;
  walletNameOverride?: string | null;
  primaryPlantLoading?: boolean;
}

const CACHE_DURATION = 120000; // 2 minutes

const formatStaked = (amount: bigint) => formatTokenAmount(amount, 18);

function formatCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

export default function PlantProfileDialog({
  open,
  onOpenChange,
  plant,
  variant = 'plant',
  walletAddressOverride = null,
  walletNameOverride = null,
  primaryPlantLoading = false,
}: PlantProfileDialogProps) {
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
  const { txModalOpen, selectedList: efpSelectedList, lists: efpLists } = useTransactions();
  const queryClient = useQueryClient();

  // Close plant profile dialog when TransactionModal opens
  useEffect(() => {
    if (txModalOpen && open) {
      onOpenChange(false);
    }
  }, [txModalOpen, open, onOpenChange]);

  // Resolve ENS/Basename using shared resolver
  const { name: ownerNameDerived, loading: isNameLoading } = usePrimaryName(ownerAddress);
  const ownerName = walletNameOverride ?? ownerNameDerived ?? null;

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
  const followTxTargetRef = React.useRef<string | null>(null);
  const followMissionRunRef = React.useRef<{ target: string; token: number } | null>(null);

  const fetchIsFollowingOwner = useCallback(
    async (lookupAddress: string, fresh: boolean): Promise<boolean> => {
      if (!connectedAddress) return false;

      const selectedListForProbe =
        efpSelectedList && efpSelectedList !== 'new list' ? efpSelectedList : undefined;
      const primaryListForProbe = efpLists?.primary_list ?? undefined;
      const probes: Array<string | number | undefined> = [undefined];

      if (selectedListForProbe !== undefined) probes.push(selectedListForProbe);
      if (primaryListForProbe !== undefined && !probes.includes(primaryListForProbe)) {
        probes.push(primaryListForProbe);
      }

      for (const listProbe of probes) {
        try {
          const status = await fetchFollowState({
            lookupAddressOrName: lookupAddress,
            connectedAddress,
            list: listProbe,
            type: 'following',
            fresh,
          });
          if (status?.state?.follow) return true;
        } catch { }
      }

      return false;
    },
    [connectedAddress, efpSelectedList, efpLists?.primary_list],
  );

  const postFollowMissionProgress = useCallback(async (): Promise<boolean> => {
    if (!connectedAddress) return false;
    try {
      const response = await postMissionProgress({
        address: connectedAddress,
        taskId: 's2_follow_player',
      });
      return response.ok;
    } catch {
      return false;
    }
  }, [connectedAddress]);

  const verifyFollowAndTrackMission = useCallback(
    async (
      lookupAddress: string,
      options?: {
        attempts?: number;
        delayMs?: number;
        token?: number;
      },
    ): Promise<boolean> => {
      const attempts = options?.attempts ?? 15;
      const delayMs = options?.delayMs ?? 1500;

      for (let attempt = 0; attempt < attempts; attempt++) {
        if (options?.token && followMissionRunRef.current?.token !== options.token) {
          return false;
        }

        const isFollowing = await fetchIsFollowingOwner(lookupAddress, true);
        if (isFollowing) {
          await queryClient.refetchQueries({ queryKey: ['followingState'], exact: false });
          const tracked = await postFollowMissionProgress();
          if (tracked) return true;
        }

        if (attempt < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      return false;
    },
    [fetchIsFollowingOwner, postFollowMissionProgress, queryClient],
  );

  const handleFollowButtonIntent = useCallback(() => {
    if (!connectedAddress || !ownerAddress) return;
    if (connectedAddress.toLowerCase() === ownerAddress.toLowerCase()) return;

    const lookupAddress = ownerAddress.toLowerCase();
    const token = Date.now();
    followTxTargetRef.current = lookupAddress;
    followMissionRunRef.current = { target: lookupAddress, token };

    // Start tracking on click so mission detection survives dialog unmount/race conditions.
    const run = async () => {
      const wasFollowingBeforeClick = await fetchIsFollowingOwner(lookupAddress, true);
      if (followMissionRunRef.current?.token !== token) return;

      // If already following, this action is likely Unfollow/Block/Mute. Do not count mission.
      if (wasFollowingBeforeClick) return;

      await verifyFollowAndTrackMission(lookupAddress, { attempts: 24, delayMs: 1500, token });
    };

    void run();
  }, [connectedAddress, ownerAddress, fetchIsFollowingOwner, verifyFollowAndTrackMission]);

  // Refresh EFP stats when TransactionModal closes (after follow/unfollow transaction completes)
  useEffect(() => {
    const canFollowOwner =
      !!connectedAddress &&
      !!ownerAddress &&
      connectedAddress.toLowerCase() !== ownerAddress.toLowerCase();

    // Capture follow target when tx modal opens. Do not depend on dialog open state.
    if (!prevTxModalOpenRef.current && txModalOpen && canFollowOwner && !followTxTargetRef.current) {
      followTxTargetRef.current = ownerAddress.toLowerCase();
    }

    // If TransactionModal was open and now it's closed, refresh stats
    if (prevTxModalOpenRef.current && !txModalOpen) {
      refreshEfpStats();
      void queryClient.refetchQueries({ queryKey: ['followingState'], exact: false });

      // Tx close fallback: verify follow state and award mission when follow succeeded.
      if (canFollowOwner) {
        const lookupAddress = followTxTargetRef.current ?? ownerAddress.toLowerCase();
        void verifyFollowAndTrackMission(lookupAddress, { attempts: 18, delayMs: 1500 });
      }

      followTxTargetRef.current = null;
    }
    prevTxModalOpenRef.current = txModalOpen;
  }, [txModalOpen, connectedAddress, ownerAddress, queryClient, refreshEfpStats, verifyFollowAndTrackMission]);

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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[440px] p-0">
          <div className="flex flex-col overflow-y-auto overflow-x-hidden">
            <div className="relative">
              <div className="h-32 bg-gradient-to-br from-primary/20 via-primary/10 to-background" />
              <div className="absolute inset-x-6 top-8 flex items-start justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                <span className="pt-1">Powered by:</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="default"
                  onClick={() => openExternalUrl('https://efp.app')}
                  className="gap-2 px-2 text-xs font-medium normal-case"
                >
                  <Image src="/icons/efp-logo.svg" alt="EFP" width={16} height={16} />
                  Ethereum Follow Protocol
                </Button>
              </div>
              <div className="absolute -bottom-8 left-6">
                <div className="relative">
                  <div
                    className={`w-24 h-24 border-4 border-background bg-background overflow-hidden shadow-lg flex items-center justify-center ${isWalletVariant ? 'rounded-full' : 'rounded-xl'
                      }`}
                  >
                    {showPrimaryLoading ? (
                      <Skeleton className="h-full w-full" />
                    ) : isWalletVariant ? (
                      ownerAddress ? (
                        <WalletAvatar
                          address={ownerAddress as `0x${string}`}
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
                    className="h-11 min-h-11 flex-1 justify-between font-mono text-sm"
                    disabled={!ownerAddress}
                  >
                    <span className="truncate">{ownerAddress ? formatAddress(ownerAddress, 6, 4) : '—'}</span>
                    <Copy className="w-4 h-4 flex-shrink-0" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleViewOnBlockscout}
                    disabled={!ownerAddress}
                    aria-label="View profile address on Blockscout"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
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
                      <div className="w-full" onClickCapture={handleFollowButtonIntent}>
                        <FollowButton
                          lookupAddress={ownerAddress as `0x${string}`}
                          connectedAddress={connectedAddress}
                          onDisconnectedClick={() => {
                            toast.error('Please connect your wallet to follow users');
                          }}
                          className="h-11 min-h-11 w-full rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                        />
                      </div>
                    </div>
                  )}

              </>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
